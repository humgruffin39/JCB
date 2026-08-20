import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import { SqliteActivityStore, type ActivityInstanceIdentity } from './activity-store.js';

function insertRace(database: ReturnType<typeof openDatabase>, raceId: string): void {
  database
    .prepare(
      `INSERT INTO races
       (id, race_date, name, kind, status, version, distance_m, going,
        scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
        created_at, updated_at)
       VALUES (?, '2026-01-01', 'Activity test', 'regular', 'betting_open', 0, 1200, 'good',
               10000, 100, 9000, 50, 1, 1)`,
    )
    .run(raceId);
}

describe('Discord Activity store', () => {
  it('atomically claims the latest launch and binds an immutable instance', () => {
    let now = 1_000;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    insertRace(database, 'race-1');
    const store = new SqliteActivityStore(database, () => now);
    store.issueLaunchIntent({
      discordUserId: '100',
      guildId: '200',
      channelId: '300',
      raceId: 'race-1',
      interactionId: '400',
    });
    now += 1;
    store.issueLaunchIntent({
      discordUserId: '100',
      guildId: '200',
      channelId: '300',
      raceId: 'race-1',
      interactionId: '401',
    });
    const identity: ActivityInstanceIdentity = {
      instanceId: 'instance-1',
      applicationId: '500',
      launchId: '600',
      guildId: '200',
      channelId: '300',
    };
    expect(store.claimIntentOrResolveInstance('100', identity)).toBe('race-1');
    // A second verified participant joins the already-bound instance without
    // being able to select or replace its race.
    expect(store.claimIntentOrResolveInstance('101', identity)).toBe('race-1');
    expect(() =>
      store.claimIntentOrResolveInstance('100', { ...identity, launchId: 'different' }),
    ).toThrow('does not match');
    database.close();
  });

  it('rejects expired, superseded, wrong-location, and concurrently consumed intents', () => {
    let now = 2_000;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    insertRace(database, 'race-1');
    const store = new SqliteActivityStore(database, () => now);
    store.issueLaunchIntent({
      discordUserId: '100',
      guildId: '200',
      channelId: '300',
      raceId: 'race-1',
      interactionId: '400',
    });
    const identity: ActivityInstanceIdentity = {
      instanceId: 'instance-1',
      applicationId: '500',
      launchId: '600',
      guildId: '200',
      channelId: 'wrong',
    };
    expect(() => store.claimIntentOrResolveInstance('100', identity)).toThrow(
      'No pending Activity launch',
    );
    store.issueLaunchIntent({
      discordUserId: '100',
      guildId: '200',
      channelId: '300',
      raceId: 'race-1',
      interactionId: '401',
    });
    store.cancelLaunchIntent('401');
    expect(() =>
      store.claimIntentOrResolveInstance('100', { ...identity, channelId: '300' }),
    ).toThrow('No pending Activity launch');
    now += 5 * 60 * 1_000;
    expect(() =>
      store.claimIntentOrResolveInstance('100', { ...identity, channelId: '300' }),
    ).toThrow('No pending Activity launch');
    database.close();
  });

  it('hashes and scopes Activity sessions and enforces CSRF and revocation', () => {
    const now = 3_000;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    insertRace(database, 'race-1');
    const store = new SqliteActivityStore(database, () => now);
    store.issueLaunchIntent({
      discordUserId: '100',
      guildId: '200',
      channelId: '300',
      raceId: 'race-1',
      interactionId: '400',
    });
    const identity: ActivityInstanceIdentity = {
      instanceId: 'instance-1',
      applicationId: '500',
      launchId: '600',
      guildId: '200',
      channelId: '300',
    };
    const raceId = store.claimIntentOrResolveInstance('100', identity);
    const session = store.createSession({
      discordUserId: '100',
      instanceId: identity.instanceId,
      raceId,
    });
    const stored = database
      .prepare('SELECT token_hash AS tokenHash FROM activity_sessions')
      .get() as {
      tokenHash: string;
    };
    expect(stored.tokenHash).not.toBe(session.sessionToken);
    expect(store.validateSession(session.sessionToken, session.csrfToken)).toMatchObject({
      discordUserId: '100',
      instanceId: 'instance-1',
      raceId: 'race-1',
    });
    expect(() => store.validateSession(session.sessionToken, 'wrong')).toThrow('CSRF');
    expect(() =>
      store.createSession({
        discordUserId: '100',
        instanceId: identity.instanceId,
        raceId: 'a-different-race',
      }),
    ).toThrow('does not match');
    store.revoke(session.sessionToken);
    expect(() => store.validateSession(session.sessionToken)).toThrow('invalid or expired');
    database.close();
  });

  it('expires a bound Activity and safely rebinds it at the next race viewer opening', () => {
    let now = 1_000;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    insertRace(database, 'race-1');
    insertRace(database, 'race-2');
    database.prepare("UPDATE races SET race_date = '2026-01-02' WHERE id = 'race-2'").run();
    database
      .prepare(
        `UPDATE races
         SET viewer_opens_at = ?, betting_closes_at = ?, scheduled_at = ?, timeline_duration_ms = ?
         WHERE id = ?`,
      )
      .run(500, 900, 1_000, 100, 'race-1');
    database
      .prepare(
        `UPDATE races
         SET viewer_opens_at = ?, betting_closes_at = ?, scheduled_at = ?
         WHERE id = ?`,
      )
      .run(5_000, 5_900, 6_000, 'race-2');
    const store = new SqliteActivityStore(database, () => now);
    const identity: ActivityInstanceIdentity = {
      instanceId: 'instance-1',
      applicationId: '500',
      launchId: '600',
      guildId: '200',
      channelId: '300',
    };
    store.issueLaunchIntent({
      discordUserId: '100',
      guildId: '200',
      channelId: '300',
      raceId: 'race-1',
      interactionId: '400',
    });
    expect(store.claimIntentOrResolveInstance('100', identity)).toBe('race-1');
    const session = store.createSession({
      discordUserId: '100',
      instanceId: identity.instanceId,
      raceId: 'race-1',
    });

    now = 5_000;
    expect(store.isRaceViewingAvailable('race-1')).toBe(false);
    expect(() => store.validateSession(session.sessionToken)).toThrow(
      'Activity race is no longer available',
    );
    store.issueLaunchIntent({
      discordUserId: '100',
      guildId: '200',
      channelId: '300',
      raceId: 'race-2',
      interactionId: '401',
    });
    expect(store.claimIntentOrResolveInstance('100', identity)).toBe('race-2');
    const switched = store.createSession({
      discordUserId: '100',
      instanceId: identity.instanceId,
      raceId: 'race-2',
    });
    expect(store.validateSession(switched.sessionToken).raceId).toBe('race-2');
    database.close();
  });

  it('selects one race when viewer opening times are identical', () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      500,
    );
    insertRace(database, 'race-1');
    insertRace(database, 'race-2');
    database
      .prepare(
        `UPDATE races
         SET viewer_opens_at = 500, betting_closes_at = 900, scheduled_at = ?
         WHERE id = ?`,
      )
      .run(1_000, 'race-1');
    database
      .prepare(
        `UPDATE races
         SET viewer_opens_at = 500, betting_closes_at = 900, scheduled_at = ?
         WHERE id = ?`,
      )
      .run(1_100, 'race-2');
    const store = new SqliteActivityStore(database, () => 500);

    expect(store.isRaceViewingAvailable('race-1')).toBe(false);
    expect(store.isRaceViewingAvailable('race-2')).toBe(true);
    database.close();
  });
});
