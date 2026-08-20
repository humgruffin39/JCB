import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteAuthStore } from './auth-store.js';
import { SqliteActivityStore } from './activity-store.js';
import { openDatabase } from './connection.js';
import { SqliteMaintenanceStore } from './maintenance-store.js';
import { applyMigrations } from './migrations.js';

describe('database retention maintenance', () => {
  it('removes expired authentication records after their recovery window', () => {
    let now = 100;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    const auth = new SqliteAuthStore(database, () => now);
    auth.issueLoginTicket('user');
    auth.issueOAuthState();
    auth.createOAuthSession('user');
    // Seed an old session explicitly so this retention test does not depend on
    // the configured lifetime of newly issued OAuth sessions.
    database
      .prepare('UPDATE web_sessions SET expires_at = ? WHERE discord_user_id = ?')
      .run(BigInt(now), 'user');
    now = 61 * 24 * 60 * 60 * 1_000;

    const result = new SqliteMaintenanceStore(database).cleanup(now);
    expect(result.expiredLoginTickets).toBe(1);
    expect(result.expiredOAuthStates).toBe(1);
    expect(result.expiredWebSessions).toBe(1);
    database.close();
  });

  it('removes expired Activity intents, sessions, and unreferenced instance bindings', () => {
    let now = 100;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    database
      .prepare(
        `INSERT INTO races
         (id, race_date, name, kind, status, version, distance_m, going,
          scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
          created_at, updated_at)
         VALUES ('race-activity-retention', '2026-01-01', 'Retention test', 'regular',
                 'betting_open', 0, 1200, 'good', 10000, 100, 9000, 50, 1, 1)`,
      )
      .run();
    const activity = new SqliteActivityStore(database, () => now);
    activity.issueLaunchIntent({
      discordUserId: '100',
      guildId: '200',
      channelId: '300',
      raceId: 'race-activity-retention',
      interactionId: '400',
    });
    const instance = {
      instanceId: 'instance-retention',
      applicationId: '500',
      launchId: '600',
      guildId: '200',
      channelId: '300',
    } as const;
    const raceId = activity.claimIntentOrResolveInstance('100', instance);
    activity.createSession({ discordUserId: '100', instanceId: instance.instanceId, raceId });
    now = 61 * 24 * 60 * 60 * 1_000;

    const result = new SqliteMaintenanceStore(database).cleanup(now);
    expect(result.expiredActivitySessions).toBe(1);
    expect(result.expiredActivityLaunchIntents).toBe(1);
    expect(result.staleActivityInstances).toBe(1);
    database.close();
  });
});
