import { parseEnvironment } from '@jcb/config';
import { applyMigrations, openDatabase, SqliteActivityStore, SqliteGameStore } from '@jcb/database';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from './build-app.js';
import type {
  DiscordActivityApi,
  DiscordActivityInstance,
  DiscordActivityOAuthToken,
} from './discord-activity-api.js';
import { SystemClock } from './system-clock.js';

const verifiedInstance: DiscordActivityInstance = {
  applicationId: '500',
  instanceId: 'instance-1',
  launchId: '600',
  location: { kind: 'gc', guildId: '200', channelId: '300' },
  userIds: ['100'],
};

function createActivityApi(instance = verifiedInstance): DiscordActivityApi {
  return {
    async exchangeCode(): Promise<DiscordActivityOAuthToken> {
      return { accessToken: 'discord-access-token', tokenType: 'Bearer' };
    },
    async getCurrentUser() {
      return { id: '100', username: 'activity-user', globalName: 'Activity User' };
    },
    async getActivityInstance() {
      return instance;
    },
  };
}

function insertRace(database: ReturnType<typeof openDatabase>): void {
  database
    .prepare(
      `INSERT INTO races
       (id, race_date, name, kind, status, version, distance_m, going,
        scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
        created_at, updated_at)
       VALUES ('race-1', '2026-01-01', 'Activity test', 'regular', 'draft', 0, 1200,
               'good', 10000, 100, 9000, 50, 1, 1)`,
    )
    .run();
}

describe('Discord Activity API', () => {
  it('verifies Discord, claims the launch, sets a scoped cookie, and reuses viewer APIs', async () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(
        dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
        'packages',
        'database',
        'migrations',
      ),
      1,
    );
    new SqliteGameStore(database, () => Date.now()).initializeEconomy([]);
    insertRace(database);
    new SqliteActivityStore(database, () => Date.now()).issueLaunchIntent({
      discordUserId: '100',
      guildId: '200',
      channelId: '300',
      raceId: 'race-1',
      interactionId: '400',
    });
    const app = await buildServer({
      database,
      environment: parseEnvironment({
        NODE_ENV: 'test',
        DISCORD_CLIENT_ID: '500',
        DISCORD_CLIENT_SECRET: 'secret',
        DISCORD_GUILD_ID: '200',
      }),
      clock: new SystemClock(),
      membership: {
        async isCurrentMember() {
          return true;
        },
      },
      activityApi: createActivityApi(),
    });

    const exchange = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/activity/exchange',
      payload: {
        code: 'oauth-code',
        instanceId: 'instance-1',
        launchId: '600',
        guildId: '200',
        channelId: '300',
      },
    });
    expect(exchange.statusCode).toBe(200);
    expect(exchange.json()).toMatchObject({
      result: {
        accessToken: 'discord-access-token',
        raceId: 'race-1',
      },
    });
    const setCookie = exchange.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0];
    expect(cookie).toMatch(/^jcb_activity_session=/);
    expect(exchange.headers['cache-control']).toBe('no-store');

    const race = await app.inject({
      method: 'GET',
      url: '/api/v1/races/race-1',
      headers: { cookie: cookie! },
    });
    expect(race.statusCode).toBe(200);
    const wrongRace = await app.inject({
      method: 'GET',
      url: '/api/v1/races/another-race',
      headers: { cookie: cookie! },
    });
    expect(wrongRace.statusCode).toBe(403);
    expect(wrongRace.json()).toMatchObject({ error: { code: 'RACE_ACCESS_REQUIRED' } });

    const csrf = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/csrf',
      headers: { cookie: cookie! },
    });
    expect(csrf.statusCode).toBe(200);
    expect(csrf.json<{ result: { csrfToken: string } }>().result.csrfToken).toEqual(
      expect.any(String),
    );
    await app.close();
    database.close();
  });

  it('rejects a user missing from the instance and a launch with no pending intent', async () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(
        dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
        'packages',
        'database',
        'migrations',
      ),
      1,
    );
    new SqliteGameStore(database, () => Date.now()).initializeEconomy([]);
    insertRace(database);
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      DISCORD_CLIENT_ID: '500',
      DISCORD_CLIENT_SECRET: 'secret',
      DISCORD_GUILD_ID: '200',
    });
    const missingUserApp = await buildServer({
      database,
      environment,
      clock: new SystemClock(),
      membership: {
        async isCurrentMember() {
          return true;
        },
      },
      activityApi: createActivityApi({ ...verifiedInstance, userIds: ['different'] }),
    });
    const invalid = await missingUserApp.inject({
      method: 'POST',
      url: '/api/v1/auth/activity/exchange',
      payload: { code: 'code', instanceId: 'instance-1' },
    });
    expect(invalid.statusCode).toBe(403);
    expect(invalid.json()).toMatchObject({ error: { code: 'ACTIVITY_INSTANCE_INVALID' } });
    await missingUserApp.close();

    const noIntentApp = await buildServer({
      database,
      environment,
      clock: new SystemClock(),
      membership: {
        async isCurrentMember() {
          return true;
        },
      },
      activityApi: createActivityApi(),
    });
    const noIntent = await noIntentApp.inject({
      method: 'POST',
      url: '/api/v1/auth/activity/exchange',
      payload: { code: 'code', instanceId: 'instance-1' },
    });
    expect(noIntent.statusCode).toBe(410);
    expect(noIntent.json()).toMatchObject({ error: { code: 'ACTIVITY_LAUNCH_NOT_FOUND' } });
    await noIntentApp.close();
    database.close();
  });
});
