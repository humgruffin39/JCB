import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_GAME_SETTINGS, gameSettingsSchema } from '@jcb/config';
import { timestamp } from '@jcb/domain';
import { SqliteAdminStore } from './admin-store.js';
import { openDatabase } from './connection.js';
import { SqliteGameStore, type HorseWrite } from './game-store.js';
import { SqliteJobStore } from './job-store.js';
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
};

describe('admin operational store', () => {
  it('exposes horse/race/economy/system operations and preserves new setting defaults', () => {
    const now = 10_000;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    const game = new SqliteGameStore(database, () => now);
    const admin = new SqliteAdminStore(database, () => now);
    game.initializeEconomy(['123456']);
    const horses = Array.from({ length: 8 }, (_, index) =>
      game.createHorse({ ...horseBase, name: `管理馬${String(index + 1)}` }),
    );
    const race = game.createRaceDraft({
      raceDate: '2026-08-10',
      name: '管理試験',
      distanceM: 1600,
      surface: 'dirt',
      scheduledAt: timestamp(100_000),
      bettingOpensAt: timestamp(20_000),
      bettingClosesAt: timestamp(90_000),
      viewerOpensAt: timestamp(80_000),
      entries: horses.map((horse, index) => ({
        horseId: horse.id,
        horseNumber: index + 1,
      })),
    });
    game.lockRace(race.id, () => 0.5, {
      conditionProbabilities: DEFAULT_GAME_SETTINGS.conditionProbabilities,
      simulationNoiseStandardDeviation: DEFAULT_GAME_SETTINGS.simulationNoiseStandardDeviation,
      fatigueMaximum: DEFAULT_GAME_SETTINGS.fatigueMaximum,
      seedLiquidityClamp: DEFAULT_GAME_SETTINGS.seedLiquidityClamp,
      raceBetLimits: DEFAULT_GAME_SETTINGS.raceBetLimits,
    });

    expect(admin.horsePerformance(horses[0]!.id).starts).toBe(1);
    expect(admin.listRaceOperations()[0]?.entriesJson).toContain(horses[0]!.id);
    expect(admin.economyOperations().accounts).toHaveLength(3);
    expect(admin.systemObjects()).toEqual({
      discordMessages: [],
      timelineObjects: [],
    });

    admin.ensureSetting('game_settings', {
      missingRaceWarningTime: DEFAULT_GAME_SETTINGS.missingRaceWarningTime,
    });
    admin.ensureSetting('game_settings', DEFAULT_GAME_SETTINGS);
    expect(gameSettingsSchema.parse(admin.getSetting('game_settings')).raceBetLimits).toEqual(
      DEFAULT_GAME_SETTINGS.raceBetLimits,
    );
    const historyBefore = admin.listSettingHistory('game_settings').length;
    const actor = game.registerUser('123456', '管理者', true);
    admin.updateSetting({
      key: 'game_settings',
      value: DEFAULT_GAME_SETTINGS,
      actorUserId: actor.id,
      reason: 'verify one history record per update',
    });
    expect(admin.listSettingHistory('game_settings')).toHaveLength(historyBefore + 1);
    const adjustment = {
      targetAccountId: actor.accountId,
      signedAmount: 250n,
      reason: 'idempotent audit test',
      idempotencyKey: 'admin-adjustment:test',
      actorUserId: actor.id,
    } as const;
    admin.adjustBalance(adjustment);
    admin.adjustBalance(adjustment);
    expect(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'ledger.adjusted'")
          .get() as { count: bigint }
      ).count,
    ).toBe(1n);
    expect(() => admin.adjustBalance({ ...adjustment, signedAmount: 500n })).toThrow(
      /different ledger transaction/i,
    );
    database.close();
  });

  it('never removes the final administrator', () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      1,
    );
    const game = new SqliteGameStore(database, () => 1);
    const admin = new SqliteAdminStore(database, () => 1);
    game.initializeEconomy(['123456']);
    expect(() =>
      admin.removeAdministrator({
        discordUserId: '123456',
        actorUserId: 'missing-user',
        reason: 'test final administrator protection',
      }),
    ).toThrow(/final administrator/i);
    database.close();
  });

  it('resets attempts when a dead-letter job is manually retried', () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      1,
    );
    const jobs = new SqliteJobStore(database, () => 0.5);
    const admin = new SqliteAdminStore(database, () => 1);
    const queued = jobs.enqueue({
      jobType: 'simulate_race',
      deduplicationKey: 'simulate:manual-retry',
      payload: { raceId: 'race-1' },
      runAt: timestamp(100),
    });
    database
      .prepare(
        `UPDATE scheduled_jobs SET status = 'dead_letter', attempt_count = 3,
         last_error_code = 'TEST', last_error_redacted = 'redacted' WHERE id = ?`,
      )
      .run(queued.id);

    admin.retryJob(queued.id, timestamp(200));

    expect(jobs.getByDeduplicationKey(queued.deduplicationKey)).toMatchObject({
      status: 'pending',
      attemptCount: 0,
      runAt: timestamp(200),
    });
    const retried = jobs.claimDue(timestamp(200), 'worker');
    expect(retried?.attemptCount).toBe(1);
    expect(jobs.fail(retried!.id, 'worker', timestamp(200), 'TEST', 'redacted')).toBe('retry_wait');
    database.close();
  });
});
