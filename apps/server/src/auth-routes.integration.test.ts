import { parseEnvironment } from '@jcb/config';
import { applyMigrations, openDatabase, SqliteAuthStore } from '@jcb/database';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from './build-app.js';
import { SystemClock } from './system-clock.js';

function insertRace(
  database: ReturnType<typeof openDatabase>,
  input: {
    readonly id: string;
    readonly viewerOpensAt: number;
    readonly scheduledAt: number;
  },
): void {
  database
    .prepare(
      `INSERT INTO races
       (id, race_date, name, kind, status, version, distance_m, going,
        scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
        created_at, updated_at)
       VALUES (?, '2026-08-20', ?, 'regular', 'betting_open', 0, 1200, 'good',
               ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.id,
      input.scheduledAt,
      input.viewerOpensAt - 2_000,
      input.scheduledAt - 1_000,
      input.viewerOpensAt,
      input.viewerOpensAt - 2_000,
      input.viewerOpensAt - 2_000,
    );
}

describe('race-scoped ticket exchange', () => {
  it('expires existing sessions and rejects new tickets when the next viewer opens', async () => {
    const database = openDatabase(':memory:');
    const migrationsDirectory = join(
      dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
      'packages',
      'database',
      'migrations',
    );
    applyMigrations(database, migrationsDirectory, Date.now());
    const now = Date.now();
    insertRace(database, {
      id: 'race-old',
      viewerOpensAt: now - 10_000,
      scheduledAt: now - 8_000,
    });
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      DISCORD_CLIENT_ID: '500',
      DISCORD_CLIENT_SECRET: 'secret',
      DISCORD_GUILD_ID: '200',
    });
    const app = await buildServer({
      database,
      environment,
      clock: new SystemClock(),
      membership: {
        async isCurrentMember() {
          return true;
        },
      },
    });
    const authStore = new SqliteAuthStore(database, () => Date.now());
    const activeTicket = authStore.issueLoginTicket('100', 'race-old');
    const activeExchange = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/tickets/exchange',
      payload: { ticket: activeTicket.ticket },
    });
    expect(activeExchange.statusCode).toBe(200);
    const setCookie = activeExchange.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0];
    expect(cookie).toBeDefined();

    insertRace(database, {
      id: 'race-next',
      viewerOpensAt: now - 1_000,
      scheduledAt: now + 1_000,
    });
    const expiredOdds = await app.inject({
      method: 'GET',
      url: '/api/v1/races/race-old/odds?poolType=win',
      headers: { cookie: cookie! },
    });
    expect(expiredOdds.statusCode).toBe(410);
    expect(expiredOdds.json()).toMatchObject({
      error: { code: 'RACE_VIEWING_UNAVAILABLE' },
    });

    const expiredTicket = authStore.issueLoginTicket('100', 'race-old');
    const exchange = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/tickets/exchange',
      payload: { ticket: expiredTicket.ticket },
    });
    expect(exchange.statusCode).toBe(410);
    expect(exchange.json()).toMatchObject({
      error: { code: 'RACE_VIEWING_UNAVAILABLE' },
    });
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM web_sessions WHERE revoked_at IS NOT NULL')
        .get(),
    ).toEqual({ count: 1n });
    await app.close();
    database.close();
  });
});
