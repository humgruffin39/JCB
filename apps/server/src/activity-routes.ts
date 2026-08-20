import { createEdgeAccessToken, createOpaqueToken } from '@jcb/application';
import { activityExchangeRequestSchema } from '@jcb/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ACTIVITY_SESSION_COOKIE, activitySessionCookieName } from './server-context.js';
import { DiscordActivityApiError, type DiscordActivityInstance } from './discord-activity-api.js';
import { envelope, httpError } from './server-support.js';
import type { ServerRouteContext } from './server-types.js';

export function registerActivityRoutes(app: FastifyInstance, context: ServerRouteContext): void {
  const { dependencies, activityApi, activityStore, gameStore, viewerStore, now } = context;

  app.post(
    '/api/v1/auth/activity/exchange',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = activityExchangeRequestSchema.parse(request.body);
      const clientId = dependencies.environment.DISCORD_CLIENT_ID;
      const guildId = dependencies.environment.DISCORD_GUILD_ID;
      if (clientId === undefined || guildId === undefined) {
        throw httpError(503, 'ACTIVITY_UNAVAILABLE', 'Discord Activity is not configured.');
      }

      let token;
      let profile;
      try {
        token = await activityApi.exchangeCode(body.code);
        profile = await activityApi.getCurrentUser(token);
      } catch (error) {
        if (
          error instanceof DiscordActivityApiError &&
          error.responseStatus !== 429 &&
          error.responseStatus < 500
        ) {
          throw httpError(
            401,
            'ACTIVITY_AUTHORIZATION_FAILED',
            'Discord could not authorize this Activity session.',
          );
        }
        throw httpError(
          503,
          'ACTIVITY_UPSTREAM_UNAVAILABLE',
          'Discord Activity authorization is temporarily unavailable.',
        );
      }

      const instance = await resolveVerifiedInstance(context, body, profile.id);
      if (instance.applicationId !== clientId || instance.location.guildId !== guildId) {
        throw httpError(
          403,
          'ACTIVITY_INSTANCE_INVALID',
          'This Activity instance does not belong to the configured Discord server.',
        );
      }
      if (!(await dependencies.membership.isCurrentMember(profile.id))) {
        throw httpError(403, 'GUILD_MEMBERSHIP_REQUIRED', 'Current guild membership is required.');
      }
      gameStore.registerUser(profile.id, profile.globalName ?? profile.username, true);

      let raceId: string;
      try {
        raceId = activityStore.claimIntentOrResolveInstance(profile.id, {
          instanceId: instance.instanceId,
          applicationId: instance.applicationId,
          launchId: instance.launchId,
          guildId,
          channelId: instance.location.channelId,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          /No pending Activity launch|claimed concurrently/.test(error.message)
        ) {
          throw httpError(
            410,
            'ACTIVITY_LAUNCH_NOT_FOUND',
            'Open this Activity again from the race message.',
          );
        }
        if (error instanceof Error && error.message.includes('identity does not match')) {
          throw httpError(
            403,
            'ACTIVITY_INSTANCE_INVALID',
            'Activity instance binding is invalid.',
          );
        }
        if (error instanceof Error && error.message === 'Activity race is no longer available.') {
          throw httpError(
            410,
            'ACTIVITY_RACE_UNAVAILABLE',
            'This Activity race is no longer available.',
          );
        }
        throw error;
      }

      let edgeAccessToken: string | undefined;
      try {
        viewerStore.getRaceDetail(raceId);
        const viewingWindow = activityStore.assertRaceViewingAvailable(raceId, now());
        const privateKey = dependencies.environment.EDGE_TOKEN_PRIVATE_KEY;
        if (privateKey !== undefined) {
          const nbf = Math.floor(now() / 1_000);
          const exp = Math.min(
            Math.floor(viewerStore.getEdgeTokenExpiry(raceId) / 1_000),
            Math.floor(viewingWindow.closesAt / 1_000),
          );
          if (exp <= nbf) throw new Error('Activity race is no longer available.');
          edgeAccessToken = createEdgeAccessToken(
            {
              raceId,
              discordUserId: profile.id,
              guildId,
              nbf,
              exp,
              jti: createOpaqueToken(),
            },
            privateKey,
          );
        }
      } catch (error) {
        if (error instanceof Error && /not found/i.test(error.message)) {
          throw httpError(404, 'RACE_NOT_FOUND', 'Race not found.');
        }
        if (error instanceof Error && error.message === 'Activity race is no longer available.') {
          throw httpError(
            410,
            'ACTIVITY_RACE_UNAVAILABLE',
            'This Activity race is no longer available.',
          );
        }
        throw error;
      }

      let session;
      try {
        session = activityStore.createSession({
          discordUserId: profile.id,
          instanceId: instance.instanceId,
          raceId,
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'Activity race is no longer available.') {
          throw httpError(
            410,
            'ACTIVITY_RACE_UNAVAILABLE',
            'This Activity race is no longer available.',
          );
        }
        throw error;
      }
      setActivitySessionCookie(
        context,
        reply,
        session.sessionToken,
        session.expiresAt,
        instance.instanceId,
      );
      reply.header('cache-control', 'no-store');
      return envelope({
        accessToken: token.accessToken,
        csrfToken: session.csrfToken,
        raceId,
        expiresAt: session.expiresAt,
        ...(edgeAccessToken === undefined ? {} : { edgeAccessToken }),
      });
    },
  );
}

async function resolveVerifiedInstance(
  context: ServerRouteContext,
  body: ReturnType<typeof activityExchangeRequestSchema.parse>,
  discordUserId: string,
): Promise<DiscordActivityInstance> {
  const { dependencies, activityApi } = context;
  let instance: DiscordActivityInstance;
  try {
    instance = await activityApi.getActivityInstance(body.instanceId);
  } catch (error) {
    const allowDevelopmentFallback =
      dependencies.environment.NODE_ENV !== 'production' &&
      dependencies.environment.DISCORD_ACTIVITY_ALLOW_UNVERIFIED_DEVELOPMENT;
    if (!allowDevelopmentFallback) {
      if (
        error instanceof DiscordActivityApiError &&
        error.responseStatus !== 429 &&
        error.responseStatus < 500
      ) {
        throw httpError(
          403,
          'ACTIVITY_INSTANCE_INVALID',
          'Discord could not verify this Activity instance.',
        );
      }
      throw httpError(
        503,
        'ACTIVITY_UPSTREAM_UNAVAILABLE',
        'Discord Activity verification is temporarily unavailable.',
      );
    }
    const applicationId = dependencies.environment.DISCORD_CLIENT_ID;
    if (
      applicationId === undefined ||
      body.launchId === undefined ||
      body.guildId === undefined ||
      body.channelId === undefined
    ) {
      throw httpError(
        403,
        'ACTIVITY_INSTANCE_INVALID',
        'Development Activity identity is incomplete.',
      );
    }
    instance = {
      applicationId,
      instanceId: body.instanceId,
      launchId: body.launchId,
      location: { kind: 'gc', guildId: body.guildId, channelId: body.channelId },
      userIds: [discordUserId],
    };
  }

  if (
    instance.instanceId !== body.instanceId ||
    instance.location.kind !== 'gc' ||
    instance.location.guildId === undefined ||
    !instance.userIds.includes(discordUserId) ||
    (body.launchId !== undefined && body.launchId !== instance.launchId) ||
    (body.guildId !== undefined && body.guildId !== instance.location.guildId) ||
    (body.channelId !== undefined && body.channelId !== instance.location.channelId)
  ) {
    throw httpError(403, 'ACTIVITY_INSTANCE_INVALID', 'Activity instance identity is invalid.');
  }
  return instance;
}

function setActivitySessionCookie(
  context: ServerRouteContext,
  reply: FastifyReply,
  sessionToken: string,
  expiresAt: number,
  instanceId: string,
): void {
  reply.header(
    'set-cookie',
    serializeActivitySessionCookie(
      context.dependencies.environment,
      sessionToken,
      expiresAt,
      instanceId,
    ),
  );
}

export function serializeActivitySessionCookie(
  environment: Pick<
    ServerRouteContext['dependencies']['environment'],
    'NODE_ENV' | 'DISCORD_CLIENT_ID'
  >,
  sessionToken: string,
  expiresAt: number,
  instanceId?: string,
): string {
  const attributes = [
    `${instanceId === undefined ? ACTIVITY_SESSION_COOKIE : activitySessionCookieName(instanceId)}=${encodeURIComponent(sessionToken)}`,
    'Path=/',
    'HttpOnly',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  const clientId = environment.DISCORD_CLIENT_ID;
  if (clientId !== undefined) {
    attributes.push(`Domain=${clientId}.discordsays.com`, 'Secure', 'SameSite=None', 'Partitioned');
  } else if (environment.NODE_ENV !== 'production') {
    attributes.push('SameSite=Lax');
  } else {
    throw new Error('DISCORD_CLIENT_ID is not configured.');
  }
  return attributes.join('; ');
}
