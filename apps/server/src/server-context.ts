import type { FastifyRequest } from 'fastify';
import { DEFAULT_GAME_SETTINGS } from '@jcb/config';
import {
  SqliteAdminStore,
  SqliteActivityStore,
  SqliteAuthStore,
  SqliteGameStore,
  SqliteJobStore,
  SqliteRaceLifecycleStore,
  SqliteViewerStore,
} from '@jcb/database';
import type { FastifyInstance } from 'fastify';
import { createHash, randomInt } from 'node:crypto';
import { requireRuntimeSecret, requireRuntimeSecrets, httpError } from './server-support.js';
import type {
  AuthenticateOptions,
  AuthenticatedSession,
  ServerDependencies,
  ServerRouteContext,
} from './server-types.js';
import type { AdminNotice } from './admin-notification.js';
import { DiscordHttpActivityApi } from './discord-activity-api.js';

const RACE_SESSION_COOKIE = 'jcb_race_session';
const ADMIN_SESSION_COOKIE = 'jcb_admin_session';
const LEGACY_SESSION_COOKIE = 'jcb_session';
const ACTIVITY_SESSION_COOKIE = 'jcb_activity_session';
const ACTIVITY_INSTANCE_HEADER = 'x-jcb-activity-instance';
const GUILD_MEMBERSHIP_CACHE_MILLISECONDS = 15 * 60 * 1000;

export function createServerRouteContext(
  app: FastifyInstance,
  dependencies: ServerDependencies,
  onNotificationError: (error: unknown) => void,
): ServerRouteContext {
  const now = () => dependencies.clock.now();
  const authStore = new SqliteAuthStore(dependencies.database, now);
  const activityStore = new SqliteActivityStore(dependencies.database, now);
  const activityApi =
    dependencies.activityApi ?? new DiscordHttpActivityApi(dependencies.environment);
  const gameStore = new SqliteGameStore(dependencies.database, now);
  const viewerStore = new SqliteViewerStore(dependencies.database);
  const adminStore = new SqliteAdminStore(dependencies.database, now);
  adminStore.ensureSetting('game_settings', DEFAULT_GAME_SETTINGS);
  const resultMasterSecrets = requireRuntimeSecrets(
    dependencies.environment.RESULT_MASTER_SECRET,
    dependencies.environment.RESULT_MASTER_SECRET_PREVIOUS,
    dependencies.environment.NODE_ENV,
    'RESULT_MASTER_SECRET',
  );
  const sessionSecret = requireRuntimeSecret(
    dependencies.environment.SESSION_SECRET,
    dependencies.environment.NODE_ENV,
    'SESSION_SECRET',
  );
  const lifecycle = new SqliteRaceLifecycleStore(dependencies.database, now, resultMasterSecrets);
  const jobStore = new SqliteJobStore(
    dependencies.database,
    () => randomInt(0, 1_000_000) / 1_000_000,
    now,
  );

  const notifyAdmin = async (notice: AdminNotice): Promise<void> => {
    if (dependencies.adminNotifier === undefined) return;
    try {
      await dependencies.adminNotifier(notice);
    } catch (error) {
      onNotificationError(error);
    }
  };

  async function authenticate(
    request: FastifyRequest,
    options: AuthenticateOptions = {},
  ): Promise<AuthenticatedSession> {
    const activityToken =
      options.admin === true ? undefined : activitySessionTokenFromRequest(request);
    if (activityToken !== undefined) {
      const csrfHeader = request.headers['x-csrf-token'];
      const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
      const activityInstanceId = activityInstanceIdFromRequest(request);
      if (options.csrf && csrfToken === undefined) {
        throw httpError(403, 'CSRF_TOKEN_REQUIRED', 'CSRF token is required.');
      }
      let session: ReturnType<typeof activityStore.validateSession>;
      try {
        session = activityStore.validateSession(
          activityToken,
          options.csrf ? csrfToken : undefined,
          activityInstanceId,
        );
      } catch (error) {
        if (error instanceof Error && error.message === 'CSRF token is invalid.') {
          throw httpError(403, 'CSRF_TOKEN_INVALID', 'CSRF token is invalid.');
        }
        if (error instanceof Error && error.message === 'Activity race is no longer available.') {
          throw httpError(
            410,
            'ACTIVITY_RACE_UNAVAILABLE',
            'This Activity race is no longer available.',
          );
        }
        throw httpError(401, 'AUTH_REQUIRED', 'Authentication required.');
      }
      if (options.raceId !== undefined && session.raceId !== options.raceId) {
        throw httpError(403, 'RACE_ACCESS_REQUIRED', 'This Activity is bound to another race.');
      }
      if (now() - session.lastGuildCheckAt >= GUILD_MEMBERSHIP_CACHE_MILLISECONDS) {
        if (!(await dependencies.membership.isCurrentMember(session.discordUserId))) {
          activityStore.revoke(activityToken);
          throw httpError(
            403,
            'GUILD_MEMBERSHIP_REQUIRED',
            'Current guild membership is required.',
          );
        }
        activityStore.markGuildChecked(session.id, now());
      }
      return {
        id: session.id,
        discordUserId: session.discordUserId,
        authenticationMethod: 'activity',
        activityInstanceId: session.instanceId,
      };
    }
    const sessionToken = sessionTokenFromRequest(request, options.admin === true);
    if (sessionToken === undefined)
      throw httpError(401, 'AUTH_REQUIRED', 'Authentication required.');
    const csrfHeader = request.headers['x-csrf-token'];
    const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
    if (options.csrf && csrfToken === undefined) {
      throw httpError(403, 'CSRF_TOKEN_REQUIRED', 'CSRF token is required.');
    }
    let session: ReturnType<typeof authStore.validateSession>;
    try {
      session = authStore.validateSession(sessionToken, options.csrf ? csrfToken : undefined);
    } catch (error) {
      if (error instanceof Error && error.message === 'CSRF token is invalid.') {
        throw httpError(403, 'CSRF_TOKEN_INVALID', 'CSRF token is invalid.');
      }
      throw httpError(401, 'AUTH_REQUIRED', 'Authentication required.');
    }
    if (options.raceId !== undefined && session.authenticationMethod === 'ticket') {
      if (session.raceId !== options.raceId) {
        throw httpError(
          403,
          'RACE_ACCESS_REQUIRED',
          'このレースはDiscordの#競馬から発行したリンクで開いてください。',
        );
      }
      try {
        activityStore.assertRaceViewingAvailable(options.raceId, now());
      } catch (error) {
        if (error instanceof Error && error.message === 'Activity race is no longer available.') {
          throw httpError(
            410,
            'RACE_VIEWING_UNAVAILABLE',
            'This race is no longer available to view.',
          );
        }
        throw error;
      }
    }
    if (options.admin) {
      if (!authStore.isAdmin(session.discordUserId)) {
        authStore.revoke(sessionToken);
        throw httpError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
      }
      if (session.authenticationMethod !== 'discord_oauth') {
        throw httpError(
          403,
          'ADMIN_OAUTH_REQUIRED',
          'Administrator access requires Discord OAuth authentication.',
        );
      }
    } else if (now() - session.lastGuildCheckAt >= GUILD_MEMBERSHIP_CACHE_MILLISECONDS) {
      if (!(await dependencies.membership.isCurrentMember(session.discordUserId))) {
        authStore.revoke(sessionToken);
        throw httpError(403, 'GUILD_MEMBERSHIP_REQUIRED', 'Current guild membership is required.');
      }
      authStore.markGuildChecked(session.id, now());
    }
    return {
      id: session.id,
      discordUserId: session.discordUserId,
      authenticationMethod: 'web',
      ...(session.reauthenticatedAt === undefined
        ? {}
        : { reauthenticatedAt: session.reauthenticatedAt }),
    };
  }

  return {
    app,
    dependencies,
    now,
    authStore,
    activityStore,
    activityApi,
    gameStore,
    viewerStore,
    adminStore,
    lifecycle,
    jobStore,
    sessionSecret,
    authenticate,
    notifyAdmin,
  };
}

export function activitySessionTokenFromRequest(request: FastifyRequest): string | undefined {
  const instanceId = activityInstanceIdFromRequest(request);
  if (instanceId !== undefined) {
    return request.cookies[activitySessionCookieName(instanceId)];
  }
  const direct = request.cookies[ACTIVITY_SESSION_COOKIE];
  if (direct !== undefined) return direct;
  const candidates = Object.entries(request.cookies).filter(([name]) =>
    name.startsWith(`${ACTIVITY_SESSION_COOKIE}_`),
  );
  return candidates.length === 1 ? candidates[0]![1] : undefined;
}

export function activityInstanceIdFromRequest(request: FastifyRequest): string | undefined {
  const value = request.headers[ACTIVITY_INSTANCE_HEADER];
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' && candidate.trim() !== '' ? candidate : undefined;
}

export function activitySessionCookieName(instanceId: string): string {
  return `${ACTIVITY_SESSION_COOKIE}_${createHash('sha256')
    .update(instanceId, 'utf8')
    .digest('hex')
    .slice(0, 32)}`;
}

export function sessionTokenFromRequest(
  request: FastifyRequest,
  admin: boolean,
): string | undefined {
  const scopedCookie = admin ? ADMIN_SESSION_COOKIE : RACE_SESSION_COOKIE;
  return (
    request.cookies[scopedCookie] ??
    request.cookies[LEGACY_SESSION_COOKIE] ??
    (admin ? request.cookies[RACE_SESSION_COOKIE] : undefined)
  );
}

export {
  ACTIVITY_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE,
  LEGACY_SESSION_COOKIE,
  RACE_SESSION_COOKIE,
};
