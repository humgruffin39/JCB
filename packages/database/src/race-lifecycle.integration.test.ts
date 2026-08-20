import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveResultKey,
  encryptAesGcm,
  prepareRace,
  type ProbabilityGenerator,
} from '@jcb/application';
import { money, timestamp, type PoolType, winningSelections } from '@jcb/domain';
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
  it('materializes only after the race and settles every bet type idempotently', async () => {
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
    const finishOrder = completion.official.finishOrder.map((finish) => finish.horseNumber);
    const pools = database
      .prepare('SELECT id, pool_type AS poolType FROM bet_pools WHERE race_id = ?')
      .all(race.id) as Array<{ id: string; poolType: PoolType }>;
    now = 20_000;
    for (const pool of pools) {
      for (const [index, selectionCode] of winningSelections(
        pool.poolType,
        finishOrder,
      ).entries()) {
        game.purchaseBet({
          userId: user.id,
          poolId: pool.id,
          poolType: pool.poolType,
          selectionCode,
          stake: money(500n),
          interactionId: `interaction-${pool.poolType}-${String(index)}`,
          idempotencyKey: `purchase:${pool.poolType}:${String(index)}`,
          expectedRaceVersion: 1,
          isGuildMember: true,
          now: timestamp(now),
        });
      }
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
    database
      .prepare(
        'UPDATE race_entries SET finish_position = 1 WHERE race_id = ? AND finish_position = 2',
      )
      .run(race.id);
    expect(() => lifecycle.settleRace(race.id, timestamp(finishAt + 3_000))).toThrow(
      /finish order is incomplete/i,
    );
    database
      .prepare(
        `UPDATE race_entries SET finish_position = 2
         WHERE race_id = ? AND horse_number = ?`,
      )
      .run(race.id, firstOfficial.finishOrder[1]!.horseNumber);
    lifecycle.settleRace(race.id, timestamp(finishAt + 3_000));
    lifecycle.settleRace(race.id, timestamp(finishAt + 3_000));
    expect(game.getRace(race.id).status).toBe('settled');
    const settledPools = database
      .prepare(
        'SELECT pool_type AS poolType, status FROM bet_pools WHERE race_id = ? ORDER BY pool_type',
      )
      .all(race.id) as Array<{ poolType: PoolType; status: string }>;
    expect(settledPools).toHaveLength(7);
    expect(settledPools.every((pool) => pool.status === 'settled')).toBe(true);
    const bets = database
      .prepare(
        `SELECT bp.pool_type AS poolType, b.status, b.payout
         FROM bets b JOIN bet_pools bp ON bp.id = b.pool_id
         WHERE bp.race_id = ? ORDER BY bp.pool_type, b.id`,
      )
      .all(race.id) as Array<{ poolType: PoolType; status: string; payout: bigint }>;
    expect(bets).toHaveLength(11);
    expect(bets.every((bet) => bet.status === 'won' && bet.payout > 0n)).toBe(true);
    const carryover = database
      .prepare("SELECT amount_projection AS amount FROM trifecta_carryover WHERE id = 'global'")
      .get() as { amount: bigint };
    expect(carryover.amount).toBe(0n);
    expect(() => game.ledgerStore().assertProjectionIntegrity()).not.toThrow();
    database.close();
  });
});
