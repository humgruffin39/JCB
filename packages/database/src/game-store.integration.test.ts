import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { identifier, money, timestamp } from '@jcb/domain';
import { transfer } from '@jcb/economy';
import { openDatabase } from './connection.js';
import { SqliteGameStore, type HorseWrite } from './game-store.js';
import { SqliteInteractionSessionStore } from './interaction-session-store.js';
import { applyMigrations } from './migrations.js';
import { SqliteRaceLifecycleStore } from './race-lifecycle-store.js';

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
};

describe('SQLite game store', () => {
  it('creates a horse atomically without a follow-up coat update', () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      1,
    );
    database.exec(`
      CREATE TRIGGER reject_coat_updates
      BEFORE UPDATE OF coat_color ON horses
      BEGIN
        SELECT RAISE(ABORT, 'coat updates are forbidden');
      END
    `);
    const store = new SqliteGameStore(database, () => 1);
    const horse = store.createHorse({ ...horseBase, name: '一括作成', coatColor: 'black' });
    expect(horse.coatColor).toBe('black');
    expect(
      (
        database.prepare("SELECT COUNT(*) AS count FROM horses WHERE name = '一括作成'").get() as {
          count: bigint;
        }
      ).count,
    ).toBe(1n);
    database.close();
  });

  it('registers once, locks immutable snapshots, funds pools, and purchases idempotently', () => {
    let now = 1_000;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    const store = new SqliteGameStore(database, () => now);
    store.initializeEconomy(['999999']);
    const user = store.registerUser('123456', 'テスター', true);
    expect(user.wasCreated).toBe(true);
    expect(store.registerUser('123456', '新しい表示名', true).wasCreated).toBe(false);
    const horses = Array.from({ length: 8 }, (_, index) =>
      store.createHorse({
        ...horseBase,
        name: `競走馬${index + 1}`,
        ...(index === 0 ? { distancePreference: 100, surfacePreference: -100 } : {}),
      }),
    );
    const race = store.createRaceDraft({
      raceDate: '2026-08-03',
      name: '統合試験',
      distanceM: 1200,
      surface: 'turf',
      scheduledAt: timestamp(100_000),
      bettingOpensAt: timestamp(10_000),
      bettingClosesAt: timestamp(90_000),
      viewerOpensAt: timestamp(80_000),
      entries: horses.map((horse, index) => ({ horseId: horse.id, horseNumber: index + 1 })),
    });
    const locked = store.lockRace(race.id, () => 0.5, {
      conditionProbabilities: {
        terrible: 0.1,
        poor: 0.2,
        normal: 0.4,
        good: 0.2,
        excellent: 0.1,
      },
      simulationNoiseStandardDeviation: 0.022,
      fatigueMaximum: 0.12,
      raceBetLimits: {
        regular: 600,
        midweek: 10_000,
        saturday_night: 20_000,
      },
    });
    expect(locked.status).toBe('locked');
    expect(locked.version).toBe(1);
    expect(locked.inputHash).toMatch(/^[a-f0-9]{64}$/);
    database.prepare('UPDATE horses SET speed = 100 WHERE id = ?').run(horses[0]!.id);
    const snapshot = database
      .prepare(
        `SELECT snapshot_speed AS speed,
                snapshot_distance_preference AS distancePreference,
                snapshot_surface_preference AS surfacePreference
         FROM race_entries WHERE race_id = ? AND horse_number = 1`,
      )
      .get(race.id) as {
      speed: bigint;
      distancePreference: bigint;
      surfacePreference: bigint;
    };
    expect(snapshot.speed).toBe(50n);
    expect(snapshot.distancePreference).toBe(100n);
    expect(snapshot.surfacePreference).toBe(-100n);

    database.prepare("UPDATE races SET status = 'simulating' WHERE id = ?").run(race.id);
    database
      .prepare(
        `INSERT INTO odds_probabilities
         (id, race_id, pool_type, selection_code, model_probability, base_odds, seed_stake, created_at)
         VALUES (?, ?, 'win', '1', 1.0, 1.0, 10000, ?)`,
      )
      .run('odds-win', race.id, BigInt(now));
    database
      .prepare(
        `INSERT INTO odds_probabilities
         (id, race_id, pool_type, selection_code, model_probability, base_odds, seed_stake, created_at)
         VALUES (?, ?, 'trifecta', '1-2-3', 1.0, 1.0, 15000, ?)`,
      )
      .run('odds-trifecta', race.id, BigInt(now));
    store.openBettingPools({
      raceId: race.id,
      winLiquidity: money(10_000n),
      trifectaLiquidity: money(15_000n),
      winPositions: [{ selectionCode: '1', stake: money(10_000n) }],
      trifectaPositions: [{ selectionCode: '1-2-3', stake: money(15_000n) }],
    });
    const pool = database
      .prepare("SELECT id FROM bet_pools WHERE race_id = ? AND pool_type = 'win'")
      .get(race.id) as { id: string };
    now = 20_000;
    const purchase = {
      userId: user.id,
      poolId: pool.id,
      poolType: 'win' as const,
      selectionCode: '1',
      stake: money(500n),
      interactionId: 'interaction-1',
      idempotencyKey: 'purchase:interaction-1',
      expectedRaceVersion: 1,
      isGuildMember: true,
      now: timestamp(now),
    };
    const purchased = store.purchaseBet(purchase);
    expect(purchased.balanceAfter).toBe(49_500n);
    expect(store.purchaseBet({ ...purchase, interactionId: 'interaction-retry' })).toEqual({
      id: purchased.id,
      wasDuplicate: true,
      balanceAfter: 49_500n,
    });
    expect(() => store.purchaseBet({ ...purchase, stake: money(400n) })).toThrow(
      /different bet purchase/i,
    );
    const sessions = new SqliteInteractionSessionStore(database, () => now);
    const session = sessions.create({
      discordUserId: '123456',
      raceId: race.id,
      raceVersion: 1,
      step: 'pool',
      payload: {},
      expiresAt: timestamp(30_000),
    });
    expect(sessions.update(session.id, 'pool', 'pick-1', { poolType: 'win' }).step).toBe('pick-1');
    expect(() => sessions.update(session.id, 'pool', 'pick-1', { poolType: 'win' })).toThrow(
      /stale|updated concurrently/i,
    );
    expect(() =>
      store.purchaseBet({
        ...purchase,
        stake: money(200n),
        interactionId: 'interaction-2',
        idempotencyKey: 'purchase:interaction-2',
      }),
    ).toThrow(/limit/i);
    expect(store.ledgerStore().balance(user.accountId)).toBe(49_500n);
    expect(() => store.updateRaceDraft(race.id, { name: '販売開始後の不正変更' })).toThrow(
      /draft/i,
    );
    const lifecycle = new SqliteRaceLifecycleStore(database, () => now, 'unused');
    lifecycle.cancelAndRefund(race.id, '統合試験の取消', timestamp(now));
    lifecycle.cancelAndRefund(race.id, '冪等な再実行', timestamp(now));
    expect(store.ledgerStore().balance(user.accountId)).toBe(50_000n);
    expect(
      (
        database.prepare('SELECT status FROM bets WHERE id = ?').get(purchased.id) as {
          status: string;
        }
      ).status,
    ).toBe('refunded');
    expect(() => store.ledgerStore().assertProjectionIntegrity()).not.toThrow();
    database.close();
  });

  it('grants relief at most once per JST day', () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      1,
    );
    const store = new SqliteGameStore(database, () => 1);
    store.initializeEconomy([]);
    const user = store.registerUser('654321', '救済試験', true);
    const bank = database
      .prepare(
        "SELECT id FROM accounts WHERE account_type = 'central_bank' AND owner_key = 'global'",
      )
      .get() as { id: string };
    store.ledgerStore().post({
      kind: 'test_drain',
      referenceType: 'user',
      referenceId: user.id,
      idempotencyKey: 'test-drain-relief-user',
      description: 'Arrange relief test balance',
      entries: transfer(user.accountId, identifier(bank.id), money(49_000n)),
    });
    expect(store.grantDailyRelief('2026-08-03')).toBe(1);
    expect(store.grantDailyRelief('2026-08-03')).toBe(0);
    expect(store.ledgerStore().balance(user.accountId)).toBe(2_000n);
    expect(store.grantDailyRelief('2026-08-04')).toBe(1);
    expect(store.ledgerStore().balance(user.accountId)).toBe(3_000n);
    database.close();
  });
});
