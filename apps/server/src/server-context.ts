import type { FastifyRequest } from 'fastify';
import { DEFAULT_GAME_SETTINGS } from '@jcb/config';
import {
  SqliteAdminStore,
  SqliteAuthStore,
  SqliteGameStore,
  SqliteJobStore,
  SqliteRaceLifecycleStore,
  SqliteViewerStore,
} from '@jcb/database';
import type { FastifyInstance } from 'fastify';
import { randomInt } from 'node:crypto';
import { requireRuntimeSecret, requireRuntimeSecrets, httpError } from './server-support.js';
import type {
  AuthenticateOptions,
  AuthenticatedSession,
  ServerDependencies,
  ServerRouteContext,
} from './server-types.js';
import type { AdminNotice } from './admin-notification.js';

const SESSION_COOKIE = 'jcb_session';
const GUILD_MEMBERSHIP_CACHE_MILLISECONDS = 15 * 60 * 1000;

export function createServerRouteContext(
  app: FastifyInstance,
  dependencies: ServerDependencies,
  onNotificationError: (error: unknown) => void,
): ServerRouteContext {
  const now = () => dependencies.clock.now();
  const authStore = new SqliteAuthStore(dependencies.database, now);
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
    const sessionToken = request.cookies[SESSION_COOKIE];
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
    if (
      options.raceId !== undefined &&
      session.authenticationMethod === 'ticket' &&
      session.raceId !== options.raceId
    ) {
      throw httpError(403, 'RACE_ACCESS_REQUIRED', 'このレースのDiscordリンクから開いてください。');
    }
    if (now() - session.lastGuildCheckAt >= GUILD_MEMBERSHIP_CACHE_MILLISECONDS) {
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

  return {
    app,
    dependencies,
    now,
    authStore,
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

export { SESSION_COOKIE };
