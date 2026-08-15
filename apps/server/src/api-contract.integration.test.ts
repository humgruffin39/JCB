import { parseEnvironment } from '@jcb/config';
import { deriveResultKey, encryptAesGcm } from '@jcb/application';
import { applyMigrations, openDatabase, SqliteAuthStore, SqliteGameStore } from '@jcb/database';
import { identifier, timestamp } from '@jcb/domain';
import { SIMULATION_VERSION, simulateOfficialRace } from '@jcb/simulation';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from './build-app.js';
import { SystemClock } from './system-clock.js';

describe('server API contract', () => {
  it('registers every required v1 path and withholds results before finish', async () => {
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
    const game = new SqliteGameStore(database, () => 1_000);
    game.initializeEconomy(['123456']);
    game.registerUser('123456', 'APIテスター', true);
    const horses = Array.from({ length: 8 }, (_, index) =>
      game.createHorse({
        name: `API馬${index + 1}`,
        status: 'active',
        runningStyle: index % 2 === 0 ? 'front_runner' : 'closer',
        speed: 50,
        start: 50,
        acceleration: 50,
        stamina: 50,
        lateKick: 50,
        conditionStability: 50,
        distancePreference: 0,
        surfacePreference: 0,
      }),
    );
    const race = game.createRaceDraft({
      raceDate: '2026-08-03',
      name: 'API契約',
      distanceM: 1200,
      surface: 'turf',
      scheduledAt: timestamp(100_000),
      bettingOpensAt: timestamp(10_000),
      bettingClosesAt: timestamp(90_000),
      viewerOpensAt: timestamp(80_000),
      entries: horses.map((horse, index) => ({ horseId: horse.id, horseNumber: index + 1 })),
    });
    game.lockRace(race.id, () => 0.5);
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      INITIAL_ADMIN_DISCORD_IDS: '123456',
      DISCORD_CLIENT_ID: '123456789',
      DISCORD_CLIENT_SECRET: 'test-client-secret',
      DISCORD_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/discord/callback',
    });
    let isGuildMember = true;
    const app = await buildServer({
      database,
      environment,
      clock: new SystemClock(),
      membership: {
        async isCurrentMember() {
          return isGuildMember;
        },
      },
    });
    for (const route of [
      ['POST', '/api/v1/auth/tickets/exchange'],
      ['POST', '/api/v1/auth/activity/exchange'],
      ['GET', '/api/v1/auth/discord/start'],
      ['GET', '/api/v1/auth/discord/callback'],
      ['POST', '/api/v1/auth/logout'],
      ['GET', '/api/v1/auth/csrf'],
      ['GET', '/api/v1/auth/admin/csrf'],
      ['GET', '/api/v1/me'],
      ['GET', '/api/v1/races/:raceId'],
      ['GET', '/api/v1/races/:raceId/odds'],
      ['GET', '/api/v1/races/:raceId/my-bets'],
      ['GET', '/api/v1/races/:raceId/result'],
      ['GET', '/api/v1/time'],
      ['GET', '/api/v1/admin/horses'],
      ['POST', '/api/v1/admin/horses'],
      ['PATCH', '/api/v1/admin/horses/:horseId'],
      ['GET', '/api/v1/admin/horses/:horseId/performance'],
      ['GET', '/api/v1/admin/races'],
      ['POST', '/api/v1/admin/races'],
      ['PATCH', '/api/v1/admin/races/:raceId'],
      ['POST', '/api/v1/admin/races/:raceId/lock'],
      ['POST', '/api/v1/admin/races/:raceId/unlock'],
      ['POST', '/api/v1/admin/races/:raceId/cancel'],
      ['POST', '/api/v1/admin/races/:raceId/retry-simulation'],
      ['POST', '/api/v1/admin/races/:raceId/retry-settlement'],
      ['POST', '/api/v1/admin/races/:raceId/rehearse-now'],
      ['POST', '/api/v1/admin/races/:raceId/emergency-reveal'],
      ['GET', '/api/v1/admin/ledger'],
      ['POST', '/api/v1/admin/ledger/adjustments'],
      ['GET', '/api/v1/admin/economy'],
      ['GET', '/api/v1/admin/jobs'],
      ['POST', '/api/v1/admin/jobs/:jobId/retry'],
      ['GET', '/api/v1/admin/audit'],
      ['GET', '/api/v1/admin/health'],
      ['GET', '/api/v1/admin/system-objects'],
      ['POST', '/api/v1/admin/object-publications/:publicationId/retry'],
      ['GET', '/api/v1/admin/settings'],
      ['GET', '/api/v1/admin/administrators'],
    ] as const) {
      expect(app.hasRoute({ method: route[0], url: route[1] })).toBe(true);
    }
    const oauthStart = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/discord/start',
    });
    expect(oauthStart.statusCode).toBe(302);
    const authorization = new URL(oauthStart.headers.location!);
    expect(authorization.searchParams.get('prompt')).toBe('consent');
    expect(authorization.searchParams.get('scope')).toBe('identify');
    const unboundCallback = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/discord/callback?code=test&state=${encodeURIComponent(
        authorization.searchParams.get('state')!,
      )}`,
    });
    expect(unboundCallback.statusCode).toBe(401);
    expect(unboundCallback.json()).toMatchObject({
      error: { code: 'OAUTH_STATE_BROWSER_MISMATCH' },
    });
    const authStore = new SqliteAuthStore(database, () => Date.now());
    const ticket = authStore.issueLoginTicket('123456', race.id);
    const exchange = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/tickets/exchange',
      payload: { ticket: ticket.ticket },
    });
    expect(exchange.statusCode).toBe(200);
    const setCookie = exchange.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0];
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/^jcb_race_session=/);
    const result = await app.inject({
      method: 'GET',
      url: `/api/v1/races/${race.id}/result`,
      headers: { cookie: cookie! },
    });
    expect(result.statusCode).toBe(425);
    expect(result.json()).toMatchObject({
      error: { code: 'RACE_NOT_FINISHED' },
    });
    const otherRace = await app.inject({
      method: 'GET',
      url: '/api/v1/races/another-race/result',
      headers: { cookie: cookie! },
    });
    expect(otherRace.statusCode).toBe(403);
    expect(otherRace.json()).toMatchObject({
      error: { code: 'RACE_ACCESS_REQUIRED' },
    });
    const ticketAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/health',
      headers: { cookie: cookie! },
    });
    expect(ticketAdmin.statusCode).toBe(403);
    expect(ticketAdmin.json()).toMatchObject({
      error: { code: 'ADMIN_OAUTH_REQUIRED' },
    });
    const oauthSession = authStore.createOAuthSession('123456');
    const oauthSessionId = authStore.validateSession(oauthSession.sessionToken).id;
    database
      .prepare('UPDATE web_sessions SET last_guild_check_at = 0 WHERE id = ?')
      .run(oauthSessionId);
    isGuildMember = false;
    const oauthAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/health',
      headers: { cookie: `jcb_session=${oauthSession.sessionToken}` },
    });
    expect(oauthAdmin.statusCode).toBe(200);
    const adminCsrf = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/admin/csrf',
      headers: {
        cookie: `jcb_session=${oauthSession.sessionToken}`,
        'x-csrf-token': oauthSession.csrfToken,
      },
    });
    expect(adminCsrf.statusCode).toBe(200);
    expect(adminCsrf.headers['cache-control']).toBe('no-store');
    expect(adminCsrf.json()).toMatchObject({
      result: { csrfToken: oauthSession.csrfToken },
    });
    expect(adminCsrf.headers['set-cookie']).toContain('jcb_admin_session=');
    isGuildMember = true;

    const resultSecret = Buffer.alloc(32, 7).toString('base64');
    const official = simulateOfficialRace(
      {
        raceId: race.id,
        raceVersion: 1,
        distanceM: 1200,
        surface: 'turf',
        entries: horses.map((horse, index) => ({
          horseNumber: index + 1,
          condition: 'normal',
          tieBreaker: 0.5,
          horse: { ...horse, horseId: identifier(horse.id) },
        })),
      },
      'emergency-audit-seed',
    );
    database
      .prepare(
        `INSERT INTO race_simulations
         (id, race_id, race_version, kind, status, seed_ciphertext, prng_version,
          simulation_version, input_hash, result_hash, encrypted_result_blob, started_at)
         VALUES ('emergency-simulation', ?, 1, 'official', 'completed', '{}', 'test',
                 ?, ?, ?, ?, ?)`,
      )
      .run(
        race.id,
        SIMULATION_VERSION,
        official.inputHash,
        official.resultHash,
        JSON.stringify(
          encryptAesGcm(
            Buffer.from(JSON.stringify(official)),
            deriveResultKey(resultSecret, race.id, SIMULATION_VERSION, 1),
          ),
        ),
        BigInt(Date.now()),
      );
    const validatedOAuth = authStore.validateSession(oauthSession.sessionToken);
    authStore.markReauthenticated(validatedOAuth.id, '123456', timestamp(Date.now()));
    const emergency = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/races/${race.id}/emergency-reveal`,
      headers: {
        cookie: `jcb_session=${oauthSession.sessionToken}`,
        'x-csrf-token': oauthSession.csrfToken,
      },
      payload: { reason: '障害調査のため正式結果の整合性を確認する' },
    });
    expect(emergency.statusCode).toBe(200);
    const audit = database
      .prepare(
        `SELECT reason, ip_hash AS ipHash FROM audit_logs
         WHERE action = 'race.emergency_revealed'`,
      )
      .get() as { reason: string; ipHash: string };
    expect(audit.reason).toContain('障害調査');
    expect(audit.ipHash).toMatch(/^[a-f0-9]{64}$/);

    const account = database
      .prepare("SELECT id FROM accounts WHERE account_type = 'user' AND owner_key = ?")
      .get(findUserId(database, '123456')) as { id: string };
    const adjustmentHeaders = {
      cookie: `jcb_session=${oauthSession.sessionToken}`,
      'x-csrf-token': oauthSession.csrfToken,
    };
    const adjustment = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ledger/adjustments',
      headers: adjustmentHeaders,
      payload: {
        accountId: account.id,
        amount: '100',
        reason: 'API idempotency regression',
        idempotencyKey: 'api-adjustment-key',
      },
    });
    expect(adjustment.statusCode).toBe(200);
    const conflictingAdjustment = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ledger/adjustments',
      headers: adjustmentHeaders,
      payload: {
        accountId: account.id,
        amount: '200',
        reason: 'API idempotency regression',
        idempotencyKey: 'api-adjustment-key',
      },
    });
    expect(conflictingAdjustment.statusCode).toBe(409);
    expect(conflictingAdjustment.json()).toMatchObject({
      error: { code: 'DUPLICATE_OPERATION' },
    });

    database
      .prepare(
        `INSERT INTO admin_allowlist
         (discord_user_id, added_by_user_id, created_at) VALUES (?, NULL, ?)`,
      )
      .run('654321', BigInt(Date.now()));
    const selfRemoval = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/administrators/123456',
      headers: {
        cookie: `jcb_session=${oauthSession.sessionToken}`,
        'x-csrf-token': oauthSession.csrfToken,
      },
      payload: { reason: '自己削除の回帰テスト' },
    });
    expect(selfRemoval.statusCode).toBe(403);
    expect(selfRemoval.json()).toMatchObject({
      apiVersion: 'v1',
      error: {
        code: 'ADMIN_SELF_REMOVAL_FORBIDDEN',
        message: 'Administrators cannot remove themselves.',
      },
    });
    expect(
      database
        .prepare('SELECT 1 AS present FROM admin_allowlist WHERE discord_user_id = ?')
        .get('123456'),
    ).toEqual({ present: 1n });
    const unregisteredAdminSession = authStore.createOAuthSession('654321');
    const createHorse = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/horses',
      headers: {
        cookie: `jcb_session=${unregisteredAdminSession.sessionToken}`,
        'x-csrf-token': unregisteredAdminSession.csrfToken,
      },
      payload: {
        name: '未登録管理者の馬',
        status: 'active',
        runningStyle: 'front_runner',
        speed: 64,
        start: 66,
        acceleration: 65,
        stamina: 64,
        lateKick: 60,
        conditionStability: 20,
        distancePreference: 10,
        surfacePreference: 0,
      },
    });
    expect(createHorse.statusCode).toBe(200);
    const createdHorse = createHorse.json<{ result: { id: string } }>().result;
    const horseAudit = database
      .prepare(
        `SELECT actor_user_id AS actorUserId FROM audit_logs
         WHERE action = 'horse.created' AND target_id = ?`,
      )
      .get(createdHorse.id) as { actorUserId: string | null };
    expect(horseAudit.actorUserId).toBeNull();

    database.prepare('DELETE FROM admin_allowlist WHERE discord_user_id = ?').run('123456');
    const removedAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/health',
      headers: { cookie: `jcb_session=${oauthSession.sessionToken}` },
    });
    expect(removedAdmin.statusCode).toBe(403);
    expect(removedAdmin.json()).toMatchObject({ error: { code: 'ADMIN_REQUIRED' } });
    const revokedSession = database
      .prepare('SELECT revoked_at AS revokedAt FROM web_sessions WHERE id = ?')
      .get(oauthSessionId) as { revokedAt: bigint | null } | undefined;
    expect(revokedSession?.revokedAt).not.toBeNull();

    await app.close();
    database.close();
  });
});

function findUserId(database: ReturnType<typeof openDatabase>, discordUserId: string): string {
  return (
    database.prepare('SELECT id FROM users WHERE discord_user_id = ?').get(discordUserId) as {
      id: string;
    }
  ).id;
}
