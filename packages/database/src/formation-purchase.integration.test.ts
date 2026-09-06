import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formationSelections, money, timestamp } from '@jcb/domain';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './connection.js';
import { SqliteGameStore, type HorseWrite, type PurchaseBetInput } from './game-store.js';
import { applyMigrations } from './migrations.js';

const horseBase: Omit<HorseWrite, 'name'> = {
  status: 'active',
  runningStyle: 'front_runner',
  speed: 50,
  start: 50,
  acceleration: 50,
  stamina: 50,
  lateKick: 50,
  conditionStability: 50,
  distancePreference: 0,
  surfacePreference: 0,
  coatColor: 'black',
};

function openRace(raceBetLimit: number) {
  const now = 1_000;
  const database = openDatabase(':memory:');
  applyMigrations(
    database,
    join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
    now,
  );
  const store = new SqliteGameStore(database, () => now);
  store.initializeEconomy([]);
  const user = store.registerUser('123456', 'テスター', true);
  const horses = Array.from({ length: 8 }, (_, index) =>
    store.createHorse({ ...horseBase, name: `競走馬${String(index + 1)}` }),
  );
  const race = store.createRaceDraft({
    raceDate: '2026-08-03',
    name: 'フォーメーション試験',
    distanceM: 1200,
    surface: 'turf',
    scheduledAt: timestamp(100_000),
    bettingOpensAt: timestamp(10_000),
    bettingClosesAt: timestamp(90_000),
    viewerOpensAt: timestamp(80_000),
    entries: horses.map((horse, index) => ({ horseId: horse.id, horseNumber: index + 1 })),
  });
  store.lockRace(race.id, () => 0.5, {
    conditionProbabilities: { terrible: 0.1, poor: 0.2, normal: 0.4, good: 0.2, excellent: 0.1 },
    simulationNoiseStandardDeviation: 0.022,
    fatigueMaximum: 0.12,
    raceBetLimits: { regular: raceBetLimit, midweek: 10_000, saturday_night: 20_000 },
  });
  database.prepare("UPDATE races SET status = 'simulating' WHERE id = ?").run(race.id);
  const selections = formationSelections('trifecta', [[1], [2, 3, 4], [2, 3, 4]]);
  const insert = database.prepare(
    `INSERT INTO odds_probabilities
     (id, race_id, pool_type, selection_code, model_probability, base_odds, seed_stake, created_at)
     VALUES (?, ?, 'trifecta', ?, 1.0, 1.0, ?, ?)`,
  );
  for (const [index, selectionCode] of selections.entries()) {
    insert.run(`odds-${String(index)}`, race.id, selectionCode, 2_500n, BigInt(now));
  }
  database
    .prepare(
      `INSERT INTO odds_probabilities
       (id, race_id, pool_type, selection_code, model_probability, base_odds, seed_stake, created_at)
       VALUES ('odds-win', ?, 'win', '1', 1.0, 1.0, 1000, ?)`,
    )
    .run(race.id, BigInt(now));
  store.openBettingPools({
    raceId: race.id,
    winLiquidity: money(1_000n),
    trifectaLiquidity: money(BigInt(2_500 * selections.length)),
    winPositions: [{ selectionCode: '1', stake: money(1_000n) }],
    trifectaPositions: selections.map((selectionCode) => ({
      selectionCode,
      stake: money(2_500n),
    })),
  });
  const pool = database
    .prepare("SELECT id FROM bet_pools WHERE race_id = ? AND pool_type = 'trifecta'")
    .get(race.id) as { id: string };
  const points = (stake: bigint, operationId: string): PurchaseBetInput[] =>
    selections.map((selectionCode) => ({
      userId: user.id,
      poolId: pool.id,
      poolType: 'trifecta' as const,
      selectionCode,
      stake: money(stake),
      interactionId: 'interaction-1',
      idempotencyKey: `discord-session:${operationId}:${selectionCode}`,
      expectedRaceVersion: 1,
      isGuildMember: true,
      now: timestamp(20_000),
    }));
  return { database, store, user, selections, points };
}

describe('formation purchases', () => {
  it('buys every point at once and replays a retried confirmation', () => {
    const { database, store, user, selections, points } = openRace(5_000);

    const purchased = store.purchaseBets(points(100n, 'operation-1'));

    expect(selections).toHaveLength(6);
    expect(purchased.bets).toHaveLength(6);
    expect(purchased.wasDuplicate).toBe(false);
    expect(purchased.balanceAfter).toBe(50_000n - 600n);
    const replay = store.purchaseBets(points(100n, 'operation-1'));
    expect(replay.wasDuplicate).toBe(true);
    expect(replay.bets.map((bet) => bet.id)).toEqual(purchased.bets.map((bet) => bet.id));
    expect(
      (database.prepare('SELECT COUNT(*) AS count FROM bets').get() as { count: bigint }).count,
    ).toBe(6n);
    expect(store.ledgerStore().balance(user.accountId)).toBe(49_400n);
    database.close();
  });

  it('leaves nothing behind when one point would break the per-race cap', () => {
    const { database, store, user, points } = openRace(500);

    expect(() => store.purchaseBets(points(100n, 'operation-1'))).toThrow(/limit/i);
    expect(
      (database.prepare('SELECT COUNT(*) AS count FROM bets').get() as { count: bigint }).count,
    ).toBe(0n);
    expect(store.ledgerStore().balance(user.accountId)).toBe(50_000n);
    expect(
      (
        database
          .prepare("SELECT user_stake_total AS total FROM bet_pools WHERE pool_type = 'trifecta'")
          .get() as { total: bigint }
      ).total,
    ).toBe(0n);
    database.close();
  });
});
