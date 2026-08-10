import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { GuildMembership, PrivateObjectStore } from '@jcb/application';
import { createEdgeAccessToken, createOpaqueToken, type JobStore } from '@jcb/application';
import { DEFAULT_GAME_SETTINGS, gameSettingsSchema, type Environment } from '@jcb/config';
import {
  adminAdjustmentSchema,
  cancellationSchema,
  createRaceSchema,
  discordOAuthCallbackSchema,
  emergencyRevealSchema,
  horseInputSchema,
  horsePatchSchema,
  jobIdParamsSchema,
  raceIdParamsSchema,
  racePatchSchema,
  ticketExchangeSchema,
} from '@jcb/contracts';
import {
  SqliteAdminStore,
  SqliteAuthStore,
  SqliteGameStore,
  SqliteJobStore,
  SqliteRaceLifecycleStore,
  SqliteViewerStore,
  type HorseWrite,
  type RaceDraftPatch,
  type SqliteDatabase,
} from '@jcb/database';
import { jstDateTimeToTimestamp, timestamp, toJstDateKey, type Clock } from '@jcb/domain';
import { ODDS_VERSION } from '@jcb/odds';
import { SIMULATION_VERSION } from '@jcb/simulation';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { createHash, randomInt } from 'node:crypto';
import { z, ZodError } from 'zod';
import { registerLocalEdgeRoutes } from './local-edge.js';

const SESSION_COOKIE = 'jcb_session';
const ONE_DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export interface ServerDependencies {
  readonly database: SqliteDatabase;
  readonly environment: Environment;
  readonly clock: Clock;
  readonly membership: GuildMembership;
  readonly discordStatus?: () => boolean;
  readonly adminNotifier?: (message: string) => Promise<void>;
  readonly timelineStore?: PrivateObjectStore;
}

interface AuthenticatedSession {
  readonly id: string;
  readonly discordUserId: string;
  readonly reauthenticatedAt?: number;
}

export async function buildServer(dependencies: ServerDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: dependencies.environment.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.ticket',
          '*.sessionToken',
          '*.officialSeed',
          '*.finishOrder',
        ],
        censor: '[REDACTED]',
      },
    },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });
  const origins = new Set(
    dependencies.environment.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  await app.register(cookie);
  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      callback(null, origin === undefined || origins.has(origin));
    },
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", ...origins],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
  });
  if (dependencies.timelineStore !== undefined) {
    registerLocalEdgeRoutes(app, {
      environment: dependencies.environment,
      clock: dependencies.clock,
      timelineStore: dependencies.timelineStore,
      database: dependencies.database,
    });
  }

  const now = () => dependencies.clock.now();
  const authStore = new SqliteAuthStore(dependencies.database, now);
  const gameStore = new SqliteGameStore(dependencies.database, now);
  const viewerStore = new SqliteViewerStore(dependencies.database);
  const adminStore = new SqliteAdminStore(dependencies.database, now);
  adminStore.ensureSetting('game_settings', DEFAULT_GAME_SETTINGS);
  const resultMasterSecret = requireRuntimeSecret(
    dependencies.environment.RESULT_MASTER_SECRET,
    dependencies.environment.NODE_ENV,
    'RESULT_MASTER_SECRET',
  );
  const sessionSecret = requireRuntimeSecret(
    dependencies.environment.SESSION_SECRET,
    dependencies.environment.NODE_ENV,
    'SESSION_SECRET',
  );
  const lifecycle = new SqliteRaceLifecycleStore(dependencies.database, now, resultMasterSecret);
  const jobStore: JobStore = new SqliteJobStore(dependencies.database, () => {
    return randomInt(0, 1_000_000) / 1_000_000;
  });

  async function authenticate(
    request: FastifyRequest,
    options: { readonly csrf?: boolean; readonly admin?: boolean } = {},
  ): Promise<AuthenticatedSession> {
    const sessionToken = request.cookies[SESSION_COOKIE];
    if (sessionToken === undefined)
      throw httpError(401, 'AUTH_REQUIRED', 'Authentication required.');
    const csrfHeader = request.headers['x-csrf-token'];
    const session = authStore.validateSession(
      sessionToken,
      options.csrf ? (Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader) : undefined,
    );
    if (now() - session.lastGuildCheckAt >= ONE_DAY_MILLISECONDS) {
      if (!(await dependencies.membership.isCurrentMember(session.discordUserId))) {
        authStore.revoke(sessionToken);
        throw httpError(403, 'GUILD_MEMBERSHIP_REQUIRED', 'Current guild membership is required.');
      }
      authStore.markGuildChecked(session.id, now());
    }
    if (options.admin && !authStore.isAdmin(session.discordUserId)) {
      throw httpError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
    }
    if (options.admin && session.authenticationMethod !== 'discord_oauth') {
      throw httpError(
        403,
        'ADMIN_OAUTH_REQUIRED',
        'Administrator access requires Discord OAuth authentication.',
      );
    }
    return {
      id: session.id,
      discordUserId: session.discordUserId,
      ...(session.reauthenticatedAt === undefined
        ? {}
        : { reauthenticatedAt: session.reauthenticatedAt }),
    };
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      void reply.status(400).send({
        apiVersion: 'v1',
        error: { code: 'VALIDATION_FAILED', message: error.issues[0]?.message ?? 'Invalid input.' },
      });
      return;
    }
    const safeError = error instanceof Error ? error : new Error('Unknown request error.');
    const taggedError = safeError as Error & {
      readonly statusCode?: number;
      readonly code?: string;
    };
    const statusCode = typeof taggedError.statusCode === 'number' ? taggedError.statusCode : 500;
    const code = typeof taggedError.code === 'string' ? taggedError.code : 'INTERNAL_ERROR';
    if (statusCode >= 500) app.log.error({ err: safeError }, 'request failed');
    void reply.status(statusCode).send({
      apiVersion: 'v1',
      error: {
        code,
        message: statusCode >= 500 ? 'Internal server error.' : safeError.message,
      },
    });
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    const health = adminStore.health();
    const infrastructureReady =
      dependencies.environment.NODE_ENV !== 'production' ||
      (health.schedulerStatus === 'nominal' &&
        health.r2AccessStatus === 'nominal' &&
        (dependencies.discordStatus?.() ?? false));
    const ready = health.ledgerProjectionValid && health.databaseReadWrite && infrastructureReady;
    if (!ready) void reply.status(503);
    return {
      status: ready ? 'ready' : 'not_ready',
      ledgerProjectionValid: health.ledgerProjectionValid,
      databaseReadWrite: health.databaseReadWrite,
    };
  });

  app.post(
    '/api/v1/auth/tickets/exchange',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = ticketExchangeSchema.parse(request.body);
      const session = authStore.exchangeLoginTicket(body.ticket);
      if (!(await dependencies.membership.isCurrentMember(session.discordUserId))) {
        authStore.revoke(session.sessionToken);
        throw httpError(403, 'GUILD_MEMBERSHIP_REQUIRED', 'Current guild membership is required.');
      }
      reply.setCookie(SESSION_COOKIE, session.sessionToken, {
        path: '/',
        httpOnly: true,
        secure: dependencies.environment.NODE_ENV === 'production',
        sameSite: dependencies.environment.NODE_ENV === 'production' ? 'none' : 'lax',
        expires: new Date(session.expiresAt),
      });
      let edgeAccessToken: string | undefined;
      if (
        session.raceId !== undefined &&
        dependencies.environment.EDGE_TOKEN_PRIVATE_KEY !== undefined &&
        dependencies.environment.DISCORD_GUILD_ID !== undefined
      ) {
        const race = viewerStore.getRaceDetail(session.raceId);
        edgeAccessToken = createEdgeAccessToken(
          {
            raceId: session.raceId,
            discordUserId: session.discordUserId,
            guildId: dependencies.environment.DISCORD_GUILD_ID,
            nbf: Math.floor(now() / 1000),
            exp: Math.floor((race.scheduledAt + ONE_DAY_MILLISECONDS) / 1000),
            jti: createOpaqueToken(),
          },
          dependencies.environment.EDGE_TOKEN_PRIVATE_KEY,
        );
      }
      return envelope({
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
        ...(session.raceId === undefined ? {} : { raceId: session.raceId }),
        ...(edgeAccessToken === undefined ? {} : { edgeAccessToken }),
      });
    },
  );

  app.get(
    '/api/v1/auth/discord/start',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const oauth = oauthConfiguration(dependencies.environment);
      const query = z
        .object({ reauthenticate: z.enum(['emergency']).optional() })
        .strict()
        .parse(request.query);
      const existingSession =
        query.reauthenticate === 'emergency'
          ? await authenticate(request, { admin: true })
          : undefined;
      const issued = authStore.issueOAuthState(
        existingSession === undefined ? 'login' : 'emergency_reauthentication',
        existingSession?.id,
      );
      const authorization = new URL('https://discord.com/oauth2/authorize');
      authorization.search = new URLSearchParams({
        response_type: 'code',
        client_id: oauth.clientId,
        redirect_uri: oauth.redirectUri,
        scope: 'identify',
        state: issued.state,
        code_challenge: createHash('sha256').update(issued.codeVerifier).digest('base64url'),
        code_challenge_method: 'S256',
        prompt: existingSession === undefined ? 'consent' : 'login',
      }).toString();
      return reply.redirect(authorization.toString());
    },
  );

  app.get(
    '/api/v1/auth/discord/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const query = discordOAuthCallbackSchema.parse(request.query);
      const oauth = oauthConfiguration(dependencies.environment);
      const oauthState = authStore.consumeOAuthState(query.state);
      const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: query.code,
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
          redirect_uri: oauth.redirectUri,
          code_verifier: oauthState.codeVerifier,
        }),
      });
      if (!tokenResponse.ok) {
        throw httpError(401, 'DISCORD_OAUTH_EXCHANGE_FAILED', 'Discord sign-in failed.');
      }
      const token = z
        .object({ access_token: z.string().min(1), token_type: z.string().min(1) })
        .parse(await tokenResponse.json());
      const profileResponse = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { authorization: `${token.token_type} ${token.access_token}` },
      });
      if (!profileResponse.ok) {
        throw httpError(401, 'DISCORD_PROFILE_FAILED', 'Discord profile could not be verified.');
      }
      const profile = z
        .object({
          id: z.string().regex(/^\d+$/),
          username: z.string().min(1).max(80),
          global_name: z.string().max(80).nullable().optional(),
        })
        .passthrough()
        .parse(await profileResponse.json());
      if (!(await dependencies.membership.isCurrentMember(profile.id))) {
        throw httpError(403, 'GUILD_MEMBERSHIP_REQUIRED', 'Current guild membership is required.');
      }
      gameStore.registerUser(profile.id, profile.global_name ?? profile.username, true);
      if (!authStore.isAdmin(profile.id)) {
        throw httpError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
      }
      if (
        oauthState.purpose === 'emergency_reauthentication' &&
        oauthState.existingSessionId !== undefined
      ) {
        authStore.markReauthenticated(oauthState.existingSessionId, profile.id, timestamp(now()));
        const destination = new URL('/admin', dependencies.environment.PUBLIC_WEB_ORIGIN);
        destination.searchParams.set('reauthenticated', 'emergency');
        return reply.redirect(destination.toString());
      }
      const session = authStore.createOAuthSession(profile.id);
      reply.setCookie(SESSION_COOKIE, session.sessionToken, {
        path: '/',
        httpOnly: true,
        secure: dependencies.environment.NODE_ENV === 'production',
        sameSite: dependencies.environment.NODE_ENV === 'production' ? 'none' : 'lax',
        expires: new Date(session.expiresAt),
      });
      const destination = new URL('/admin', dependencies.environment.PUBLIC_WEB_ORIGIN);
      destination.hash = new URLSearchParams({ csrf: session.csrfToken }).toString();
      return reply.redirect(destination.toString());
    },
  );

  app.post('/api/v1/auth/logout', async (request, reply) => {
    await authenticate(request, { csrf: true });
    const token = request.cookies[SESSION_COOKIE]!;
    authStore.revoke(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return envelope({ loggedOut: true });
  });

  app.get('/api/v1/me', async (request) => {
    const session = await authenticate(request);
    return envelope(viewerStore.getMe(session.discordUserId));
  });
  app.get('/api/v1/time', async (request) => {
    await authenticate(request);
    return envelope({ epochMilliseconds: now() });
  });
  app.get('/api/v1/settings/public', async (request) => {
    await authenticate(request);
    const settings = gameSettingsSchema.parse(adminStore.getSetting('game_settings'));
    return envelope({
      recommendedLockTime: settings.recommendedLockTime,
      viewerOpenTime: settings.viewerOpenTime,
      bettingCloseTime: settings.bettingCloseTime,
      startTime: settings.startTime,
      webOddsPollMilliseconds: settings.webOddsPollMilliseconds,
      visualEffectStrength: settings.visualEffectStrength,
      soundVolume: settings.soundVolume,
    });
  });
  app.get('/api/v1/races/:raceId', async (request) => {
    await authenticate(request);
    const { raceId } = raceIdParamsSchema.parse(request.params);
    return envelope(viewerStore.getRaceDetail(raceId));
  });
  app.get('/api/v1/races/:raceId/odds', async (request) => {
    await authenticate(request);
    const { raceId } = raceIdParamsSchema.parse(request.params);
    const query = z
      .object({
        poolType: z.enum(['win', 'trifecta']).default('win'),
        selectionCode: z.string().max(20).optional(),
      })
      .parse(request.query);
    return envelope(viewerStore.getOdds(raceId, query.poolType, query.selectionCode));
  });
  app.get('/api/v1/races/:raceId/my-bets', async (request) => {
    const session = await authenticate(request);
    const { raceId } = raceIdParamsSchema.parse(request.params);
    return envelope(viewerStore.getMyBets(raceId, session.discordUserId));
  });
  app.get('/api/v1/races/:raceId/result', async (request) => {
    await authenticate(request);
    const { raceId } = raceIdParamsSchema.parse(request.params);
    try {
      return envelope(viewerStore.getResult(raceId));
    } catch (error) {
      if (error instanceof Error && error.message === 'RACE_NOT_FINISHED') {
        throw httpError(425, 'RACE_NOT_FINISHED', 'Official result is unavailable before finish.');
      }
      throw error;
    }
  });
  app.post('/api/v1/races/:raceId/edge-token', async (request) => {
    const session = await authenticate(request, { csrf: true });
    const { raceId } = raceIdParamsSchema.parse(request.params);
    const privateKey = dependencies.environment.EDGE_TOKEN_PRIVATE_KEY;
    const guildId = dependencies.environment.DISCORD_GUILD_ID;
    if (privateKey === undefined || guildId === undefined) {
      throw httpError(503, 'EDGE_TOKEN_UNAVAILABLE', 'Edge access is not configured.');
    }
    return envelope({
      edgeAccessToken: createEdgeAccessToken(
        {
          raceId,
          discordUserId: session.discordUserId,
          guildId,
          nbf: Math.floor(now() / 1000),
          exp: Math.floor(viewerStore.getEdgeTokenExpiry(raceId) / 1000),
          jti: createOpaqueToken(),
        },
        privateKey,
      ),
    });
  });

  app.get('/api/v1/admin/horses', async (request) => {
    await authenticate(request, { admin: true });
    return envelope(gameStore.listHorses());
  });
  app.get('/api/v1/admin/horses/:horseId/performance', async (request) => {
    await authenticate(request, { admin: true });
    const { horseId } = z.object({ horseId: z.string().min(1).max(80) }).parse(request.params);
    gameStore.getHorse(horseId);
    return envelope(adminStore.horsePerformance(horseId));
  });
  app.post('/api/v1/admin/horses', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const horse = gameStore.createHorse(horseInputSchema.parse(request.body));
    adminStore.recordAudit({
      actorUserId: findOptionalInternalUserId(dependencies.database, session.discordUserId),
      action: 'horse.created',
      targetType: 'horse',
      targetId: horse.id,
      after: horse,
    });
    return envelope(horse);
  });
  app.patch('/api/v1/admin/horses/:horseId', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const { horseId } = z.object({ horseId: z.string().min(1) }).parse(request.params);
    const before = gameStore.getHorse(horseId);
    const horse = gameStore.updateHorse(
      horseId,
      withoutUndefined(horsePatchSchema.parse(request.body)) as Partial<HorseWrite>,
    );
    adminStore.recordAudit({
      actorUserId: findOptionalInternalUserId(dependencies.database, session.discordUserId),
      action: 'horse.updated',
      targetType: 'horse',
      targetId: horse.id,
      before,
      after: horse,
    });
    return envelope(horse);
  });

  app.get('/api/v1/admin/races', async (request) => {
    await authenticate(request, { admin: true });
    return envelope(adminStore.listRaceOperations());
  });
  app.post('/api/v1/admin/races', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const input = createRaceSchema.parse(request.body);
    const { kind, ...raceInput } = input;
    const race = gameStore.createRaceDraft({
      ...raceInput,
      ...(kind === undefined ? {} : { kind }),
      scheduledAt: timestamp(input.scheduledAt),
      bettingOpensAt: timestamp(input.bettingOpensAt),
      bettingClosesAt: timestamp(input.bettingClosesAt),
      viewerOpensAt: timestamp(input.viewerOpensAt),
    });
    adminStore.recordAudit({
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
      action: 'race.created',
      targetType: 'race',
      targetId: race.id,
      after: race,
    });
    await dependencies.adminNotifier?.(
      `🔒 レースを確定しsimulationを予約しました: ${race.name} / v${String(race.version)}`,
    );
    return envelope(race);
  });
  app.patch('/api/v1/admin/races/:raceId', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const { raceId } = raceIdParamsSchema.parse(request.params);
    const parsed = racePatchSchema.parse(request.body);
    const before = gameStore.getRace(raceId);
    const racePatch = withoutUndefined({
      ...parsed,
      ...(parsed.scheduledAt === undefined ? {} : { scheduledAt: timestamp(parsed.scheduledAt) }),
      ...(parsed.bettingOpensAt === undefined
        ? {}
        : { bettingOpensAt: timestamp(parsed.bettingOpensAt) }),
      ...(parsed.bettingClosesAt === undefined
        ? {}
        : { bettingClosesAt: timestamp(parsed.bettingClosesAt) }),
      ...(parsed.viewerOpensAt === undefined
        ? {}
        : { viewerOpensAt: timestamp(parsed.viewerOpensAt) }),
    }) as RaceDraftPatch;
    const race = gameStore.updateRaceDraft(raceId, racePatch);
    adminStore.recordAudit({
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
      action: 'race.updated',
      targetType: 'race',
      targetId: race.id,
      before,
      after: race,
    });
    return envelope(race);
  });
  app.post('/api/v1/admin/races/:raceId/lock', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const { raceId } = raceIdParamsSchema.parse(request.params);
    const settings = gameSettingsSchema.parse(adminStore.getSetting('game_settings'));
    const race = gameStore.lockRace(raceId, secureRandomUnit, {
      conditionProbabilities: settings.conditionProbabilities,
      simulationNoiseStandardDeviation: settings.simulationNoiseStandardDeviation,
      fatigueMaximum: settings.fatigueMaximum,
      seedLiquidityClamp: settings.seedLiquidityClamp,
      raceBetLimits: settings.raceBetLimits,
    });
    jobStore.enqueue({
      jobType: 'simulate_race',
      deduplicationKey: `simulate:${race.id}:${String(race.version)}`,
      payload: { raceId: race.id },
      runAt: now(),
    });
    adminStore.recordAudit({
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
      action: 'race.locked',
      targetType: 'race',
      targetId: race.id,
      after: { version: race.version, inputHash: race.inputHash },
    });
    return envelope(race);
  });
  app.post('/api/v1/admin/races/:raceId/unlock', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const { raceId } = raceIdParamsSchema.parse(request.params);
    const before = gameStore.getRace(raceId);
    const race = gameStore.unlockRace(raceId);
    adminStore.recordAudit({
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
      action: 'race.unlocked',
      targetType: 'race',
      targetId: raceId,
      before,
      after: race,
    });
    return envelope(race);
  });
  app.post('/api/v1/admin/races/:raceId/cancel', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const { raceId } = raceIdParamsSchema.parse(request.params);
    const { reason } = cancellationSchema.parse(request.body);
    lifecycle.cancelAndRefund(raceId, reason, now());
    jobStore.enqueue({
      jobType: 'refresh_rankings',
      deduplicationKey: `rankings:cancel:${raceId}:${String(now())}`,
      payload: { raceId },
      runAt: now(),
    });
    adminStore.recordAudit({
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
      action: 'race.cancelled',
      targetType: 'race',
      targetId: raceId,
      reason,
    });
    await dependencies.adminNotifier?.(`🚫 レースを中止し全額返金しました: ${raceId} / ${reason}`);
    return envelope({ cancelled: true });
  });
  app.post('/api/v1/admin/races/:raceId/retry-simulation', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const { raceId } = raceIdParamsSchema.parse(request.params);
    const race = gameStore.getRace(raceId);
    jobStore.enqueue({
      jobType: 'simulate_race',
      deduplicationKey: `simulate:${raceId}:${String(race.version)}:manual:${String(now())}`,
      payload: { raceId },
      runAt: now(),
    });
    adminStore.recordAudit({
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
      action: 'race.simulation_retry_queued',
      targetType: 'race',
      targetId: raceId,
    });
    return envelope({ queued: true });
  });
  app.post('/api/v1/admin/races/:raceId/retry-settlement', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const { raceId } = raceIdParamsSchema.parse(request.params);
    jobStore.enqueue({
      jobType: 'settle_race',
      deduplicationKey: `settle:${raceId}:manual:${String(now())}`,
      payload: { raceId },
      runAt: now(),
    });
    adminStore.recordAudit({
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
      action: 'race.settlement_retry_queued',
      targetType: 'race',
      targetId: raceId,
    });
    return envelope({ queued: true });
  });
  app.post('/api/v1/admin/races/:raceId/rehearse-now', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const { raceId } = raceIdParamsSchema.parse(request.params);
    const race = gameStore.getRace(raceId);
    if (race.status !== 'betting_open') {
      throw httpError(409, 'INVALID_RACE_STATE', 'Only an open rehearsal race can run now.');
    }
    const timing = dependencies.database
      .prepare(
        `SELECT scheduled_at AS scheduledAt, timeline_duration_ms AS timelineDurationMs
         FROM races WHERE id = ?`,
      )
      .get(raceId) as { scheduledAt: bigint; timelineDurationMs: bigint | null } | undefined;
    if (timing?.timelineDurationMs === null || timing === undefined) {
      throw httpError(
        409,
        'RACE_NOT_PREPARED',
        'Complete race simulation before running rehearsal.',
      );
    }
    const runAt = now();
    const scheduledAt = timestamp(runAt + 3_000);
    const finishAt = timestamp(Number(scheduledAt + timing.timelineDurationMs));
    const run = dependencies.database.transaction(() => {
      dependencies.database
        .prepare(
          'UPDATE races SET scheduled_at = ?, betting_closes_at = ?, viewer_opens_at = ?, updated_at = ? WHERE id = ?',
        )
        .run(BigInt(scheduledAt), BigInt(runAt), BigInt(runAt), BigInt(runAt), raceId);
      lifecycle.closeBetting(raceId, timestamp(runAt));
      lifecycle.markReady(raceId);
      lifecycle.markRunning(raceId, scheduledAt);
      lifecycle.markFinished(raceId, finishAt);
      lifecycle.settleRace(raceId, timestamp(finishAt + 3_000));
      dependencies.database
        .prepare(
          `UPDATE scheduled_jobs SET status = 'completed', locked_at = NULL, locked_by = NULL,
           updated_at = ? WHERE deduplication_key IN (?, ?, ?, ?, ?)
           AND status IN ('pending', 'retry_wait')`,
        )
        .run(
          BigInt(runAt),
          `open-viewer:${raceId}:${String(race.version)}`,
          `close:${raceId}:${String(race.version)}`,
          `running:${raceId}:${String(race.version)}`,
          `finished:${raceId}:${String(race.version)}`,
          `settle:${raceId}:${String(race.version)}`,
        );
    });
    run.immediate();
    jobStore.enqueue({
      jobType: 'publish_race',
      deduplicationKey: `publish:${raceId}:rehearsal:${String(runAt)}`,
      payload: { raceId },
      runAt,
    });
    jobStore.enqueue({
      jobType: 'refresh_rankings',
      deduplicationKey: `rankings:${raceId}:rehearsal:${String(runAt)}`,
      payload: { raceId },
      runAt,
    });
    adminStore.recordAudit({
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
      action: 'race.rehearsal_completed_now',
      targetType: 'race',
      targetId: raceId,
    });
    return envelope({ settled: true });
  });
  app.post('/api/v1/admin/races/:raceId/emergency-reveal', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const { raceId } = raceIdParamsSchema.parse(request.params);
    const body = emergencyRevealSchema.parse(request.body);
    if (
      session.reauthenticatedAt === undefined ||
      now() - session.reauthenticatedAt > 5 * 60 * 1_000
    ) {
      throw httpError(
        403,
        'REAUTHENTICATION_REQUIRED',
        'Discord reauthentication is required within five minutes.',
      );
    }
    const result = lifecycle.emergencyReveal(raceId);
    adminStore.recordAudit({
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
      action: 'race.emergency_revealed',
      targetType: 'race',
      targetId: raceId,
      reason: body.reason,
      ipHash: hashIp(request.ip, sessionSecret),
    });
    await dependencies.adminNotifier?.(
      `🚨 緊急結果閲覧が実行されました: ${raceId} / ${body.reason}`,
    );
    return envelope(result);
  });

  app.get('/api/v1/admin/ledger', async (request) => {
    await authenticate(request, { admin: true });
    return envelope(adminStore.listLedger());
  });
  app.get('/api/v1/admin/economy', async (request) => {
    await authenticate(request, { admin: true });
    return envelope(adminStore.economyOperations());
  });
  app.post('/api/v1/admin/ledger/adjustments', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const body = adminAdjustmentSchema.parse(request.body);
    const transactionId = adminStore.adjustBalance({
      targetAccountId: body.accountId,
      signedAmount: BigInt(body.amount),
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
    });
    jobStore.enqueue({
      jobType: 'refresh_rankings',
      deduplicationKey: `rankings:adjustment:${transactionId}`,
      payload: {},
      runAt: now(),
    });
    return envelope({ transactionId });
  });
  app.get('/api/v1/admin/jobs', async (request) => {
    await authenticate(request, { admin: true });
    return envelope(adminStore.listJobs());
  });
  app.post('/api/v1/admin/jobs/:jobId/retry', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const { jobId } = jobIdParamsSchema.parse(request.params);
    adminStore.retryJob(jobId, now());
    adminStore.recordAudit({
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
      action: 'job.retry_queued',
      targetType: 'scheduled_job',
      targetId: jobId,
    });
    return envelope({ queued: true });
  });
  app.get('/api/v1/admin/audit', async (request) => {
    await authenticate(request, { admin: true });
    return envelope(adminStore.listAudit());
  });
  app.get('/api/v1/admin/health', async (request) => {
    await authenticate(request, { admin: true });
    const residentSetBytes = process.memoryUsage().rss;
    return envelope({
      ...adminStore.health(),
      applicationVersion: process.env.FLY_IMAGE_REF ?? process.env.GIT_SHA ?? 'development',
      simulationVersion: SIMULATION_VERSION,
      oddsVersion: ODDS_VERSION,
      residentSetBytes,
      memoryStatus:
        residentSetBytes >= 480 * 1_024 * 1_024
          ? 'failure'
          : residentSetBytes >= 430 * 1_024 * 1_024
            ? 'warning'
            : 'nominal',
      discordGatewayConnected: dependencies.discordStatus?.() ?? false,
    });
  });
  app.get('/api/v1/admin/system-objects', async (request) => {
    await authenticate(request, { admin: true });
    return envelope(adminStore.systemObjects());
  });
  app.get('/api/v1/admin/administrators', async (request) => {
    await authenticate(request, { admin: true });
    return envelope(adminStore.listAdministrators());
  });
  app.post('/api/v1/admin/administrators', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const body = z
      .object({
        discordUserId: z.string().regex(/^\d{5,25}$/),
        reason: z.string().trim().min(5).max(300),
      })
      .strict()
      .parse(request.body);
    adminStore.addAdministrator({
      ...body,
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
    });
    return envelope({ added: true });
  });
  app.delete('/api/v1/admin/administrators/:discordUserId', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const { discordUserId } = z
      .object({ discordUserId: z.string().regex(/^\d{5,25}$/) })
      .parse(request.params);
    const { reason } = z
      .object({ reason: z.string().trim().min(5).max(300) })
      .strict()
      .parse(request.body);
    adminStore.removeAdministrator({
      discordUserId,
      reason,
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
    });
    return envelope({ removed: true });
  });
  app.get('/api/v1/admin/settings', async (request) => {
    await authenticate(request, { admin: true });
    return envelope({
      gameSettings: gameSettingsSchema.parse(adminStore.getSetting('game_settings')),
      history: adminStore.listSettingHistory('game_settings'),
    });
  });
  app.put('/api/v1/admin/settings/game', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const body = z
      .object({
        settings: gameSettingsSchema,
        reason: z.string().trim().min(5).max(300),
      })
      .strict()
      .parse(request.body);
    adminStore.updateSetting({
      key: 'game_settings',
      value: body.settings,
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
      reason: body.reason,
    });
    rescheduleMissingRaceWarnings(
      dependencies.database,
      now(),
      body.settings.missingRaceWarningTime,
    );
    return envelope({ updated: true, gameSettings: body.settings });
  });

  return app;
}

function envelope<Result>(result: Result): { readonly apiVersion: 'v1'; readonly result: Result } {
  return { apiVersion: 'v1', result };
}

function secureRandomUnit(): number {
  return randomInt(0, 4_294_967_296) / 4_294_967_296;
}

function requireRuntimeSecret(
  value: string | undefined,
  nodeEnvironment: string,
  name: string,
): string {
  if (value !== undefined) return value;
  if (nodeEnvironment === 'production') throw new Error(`${name} is required.`);
  return Buffer.alloc(32, 7).toString('base64');
}

function httpError(statusCode: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

function findInternalUserId(database: SqliteDatabase, discordUserId: string): string {
  const row = database
    .prepare('SELECT id FROM users WHERE discord_user_id = ?')
    .get(discordUserId) as { id: string } | undefined;
  if (row === undefined) throw new Error('Authenticated user is not registered.');
  return row.id;
}

function findOptionalInternalUserId(
  database: SqliteDatabase,
  discordUserId: string,
): string | undefined {
  const row = database
    .prepare('SELECT id FROM users WHERE discord_user_id = ?')
    .get(discordUserId) as { id: string } | undefined;
  return row?.id;
}

export function hashIp(ip: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${ip}`).digest('hex');
}

function withoutUndefined(input: object): object {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function rescheduleMissingRaceWarnings(
  database: SqliteDatabase,
  now: number,
  timeOfDay: string,
): void {
  for (const offset of [0, 1]) {
    const currentDate = toJstDateKey(timestamp(now));
    const date = toJstDateKey(
      timestamp(Date.parse(`${currentDate}T00:00:00+09:00`) + offset * 24 * 60 * 60 * 1_000),
    );
    const scheduled = jstDateTimeToTimestamp(date, timeOfDay);
    database
      .prepare(
        `UPDATE scheduled_jobs SET run_at = ?, updated_at = ?
         WHERE deduplication_key = ? AND status IN ('pending', 'retry_wait')`,
      )
      .run(BigInt(scheduled < now ? now : scheduled), BigInt(now), `warn-missing-race:${date}`);
  }
}

function oauthConfiguration(environment: Environment): {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
} {
  const clientId = environment.DISCORD_CLIENT_ID;
  const clientSecret = environment.DISCORD_CLIENT_SECRET;
  const redirectUri = environment.DISCORD_REDIRECT_URI;
  if (clientId === undefined || clientSecret === undefined || redirectUri === undefined) {
    throw httpError(503, 'DISCORD_OAUTH_UNAVAILABLE', 'Discord OAuth is not configured.');
  }
  return { clientId, clientSecret, redirectUri };
}
