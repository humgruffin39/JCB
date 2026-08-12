import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveResultKey,
  encryptAesGcm,
  prepareRace,
  type ProbabilityGenerator,
} from '@jcb/application';
import { money, timestamp } from '@jcb/domain';
import { generateProbabilities } from '@jcb/odds';
import { openDatabase } from './connection.js';
import { SqliteGameStore, type HorseWrite } from './game-store.js';
import { applyMigrations } from './migrations.js';
import { SqliteRaceLifecycleStore } from './race-lifecycle-store.js';
import { SqliteRacePreparationRepository } from './race-preparation-repository.js';

const horseBase: Omit<HorseWrite, 'name' | 'speed' | 'runningStyle'> = {
  status: 'active',
  start: 50,
  acceleration: 50,
  stamina: 50,
  lateKick: 50,
  conditionStability: 50,
  distancePreference: 0,
  surfacePreference: 0,
};

describe('race lifecycle and settlement', () => {
  it('materializes only after the race and settles win plus trifecta carryover idempotently', async () => {
    let now = 1_000;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    const resultMasterSecret = randomBytes(32).toString('base64');
    const timelineMasterSecret = randomBytes(32).toString('base64');
    const { privateKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const game = new SqliteGameStore(database, () => now);
    game.initializeEconomy([]);
    const user = game.registerUser('123456', '精算テスター', true);
    const horses = Array.from({ length: 8 }, (_, index) =>
      game.createHorse({
        ...horseBase,
        name: `精算馬${index + 1}`,
        speed: 50 + index,
        runningStyle: index % 2 === 0 ? 'front_runner' : 'closer',
      }),
    );
    const race = game.createRaceDraft({
      raceDate: '2026-08-08',
      name: '精算試験',
      distanceM: 1200,
      surface: 'turf',
      scheduledAt: timestamp(100_000),
      bettingOpensAt: timestamp(10_000),
      bettingClosesAt: timestamp(90_000),
      viewerOpensAt: timestamp(80_000),
      entries: horses.map((horse, index) => ({ horseId: horse.id, horseNumber: index + 1 })),
    });
    game.lockRace(race.id, () => 0.5);
    const probabilityGenerator: ProbabilityGenerator = {
      async generate(input, seed) {
        return generateProbabilities(input, seed, 120);
      },
    };
    const completion = await prepareRace(race.id, {
      repository: new SqliteRacePreparationRepository(database, () => now, resultMasterSecret),
      probabilityGenerator,
      timelineMasterSecret,
      resultMasterSecret,
      manifestPrivateKey: privateKey,
    });
    const legacySimulationVersion = 'sim-v0';
    const legacyEncryptedResult = encryptAesGcm(
      Buffer.from(JSON.stringify(completion.official), 'utf8'),
      deriveResultKey(resultMasterSecret, race.id, legacySimulationVersion, 1),
    );
    database
      .prepare(
        `UPDATE race_simulations
         SET simulation_version = ?, encrypted_result_blob = ?
         WHERE race_id = ? AND race_version = 1 AND kind = 'official'`,
      )
      .run(legacySimulationVersion, JSON.stringify(legacyEncryptedResult), race.id);
    const winner = completion.official.finishOrder[0]!.horseNumber;
    const winningTrifecta = completion.official.finishOrder
      .slice(0, 3)
      .map((finish) => finish.horseNumber)
      .join('-');
    const losingTrifecta = winningTrifecta === '1-2-3' ? '8-7-6' : '1-2-3';
    const pools = database
      .prepare('SELECT id, pool_type AS poolType FROM bet_pools WHERE race_id = ?')
      .all(race.id) as Array<{ id: string; poolType: 'win' | 'trifecta' }>;
    now = 20_000;
    for (const pool of pools) {
      game.purchaseBet({
        userId: user.id,
        poolId: pool.id,
        poolType: pool.poolType,
        selectionCode: pool.poolType === 'win' ? String(winner) : losingTrifecta,
        stake: money(500n),
        interactionId: `interaction-${pool.poolType}`,
        idempotencyKey: `purchase:${pool.poolType}`,
        expectedRaceVersion: 1,
        isGuildMember: true,
        now: timestamp(now),
      });
    }
    const lifecycle = new SqliteRaceLifecycleStore(database, () => now, resultMasterSecret);
    expect(() => lifecycle.closeBetting(race.id, timestamp(89_999))).toThrow();
    lifecycle.closeBetting(race.id, timestamp(90_000));
    lifecycle.closeBetting(race.id, timestamp(90_000));
    lifecycle.markReady(race.id);
    lifecycle.markReady(race.id);
    expect(() => lifecycle.markRunning(race.id, timestamp(99_999))).toThrow();
    lifecycle.markRunning(race.id, timestamp(100_000));
    lifecycle.markRunning(race.id, timestamp(100_000));
    expect(
      (
        database
          .prepare(
            'SELECT COUNT(*) AS count FROM race_entries WHERE race_id = ? AND finish_position IS NOT NULL',
          )
          .get(race.id) as { count: bigint }
      ).count,
    ).toBe(0n);
    const finishAt = 100_000 + completion.official.timelineDurationMs;
    const firstOfficial = lifecycle.markFinished(race.id, timestamp(finishAt));
    expect(lifecycle.markFinished(race.id, timestamp(finishAt))).toEqual(firstOfficial);
    lifecycle.settleRace(race.id, timestamp(finishAt + 3_000));
    lifecycle.settleRace(race.id, timestamp(finishAt + 3_000));
    expect(game.getRace(race.id).status).toBe('settled');
    const winBet = database
      .prepare(
        `SELECT b.status, b.payout FROM bets b JOIN bet_pools bp ON bp.id = b.pool_id
         WHERE bp.race_id = ? AND bp.pool_type = 'win'`,
      )
      .get(race.id) as { status: string; payout: bigint };
    expect(winBet.status).toBe('won');
    expect(winBet.payout).toBeGreaterThan(0n);
    const trifectaBet = database
      .prepare(
        `SELECT b.status, b.payout FROM bets b JOIN bet_pools bp ON bp.id = b.pool_id
         WHERE bp.race_id = ? AND bp.pool_type = 'trifecta'`,
      )
      .get(race.id) as { status: string; payout: bigint };
    expect(trifectaBet).toEqual({ status: 'lost', payout: 0n });
    const carryover = database
      .prepare("SELECT amount_projection AS amount FROM trifecta_carryover WHERE id = 'global'")
      .get() as { amount: bigint };
    expect(carryover.amount).toBe(500n);
    expect(() => game.ledgerStore().assertProjectionIntegrity()).not.toThrow();
    database.close();
  });
});
