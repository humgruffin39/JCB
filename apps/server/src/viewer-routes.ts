import { createEdgeAccessToken, createOpaqueToken } from '@jcb/application';
import { gameSettingsSchema } from '@jcb/config';
import { raceIdParamsSchema } from '@jcb/contracts';
import { POOL_TYPES } from '@jcb/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { envelope, httpError } from './server-support.js';
import type { ServerRouteContext } from './server-types.js';

export function registerViewerRoutes(app: FastifyInstance, context: ServerRouteContext): void {
  const { dependencies, now, viewerStore, activityStore, adminStore, authenticate } = context;

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
    const { raceId } = raceIdParamsSchema.parse(request.params);
    await authenticate(request, { raceId });
    return envelope(viewerStore.getRaceDetail(raceId));
  });
  app.get('/api/v1/races/:raceId/odds', async (request) => {
    const { raceId } = raceIdParamsSchema.parse(request.params);
    await authenticate(request, { raceId });
    const query = z
      .object({
        poolType: z.enum(POOL_TYPES).default('win'),
        selectionCode: z.string().max(20).optional(),
      })
      .parse(request.query);
    return envelope(viewerStore.getOdds(raceId, query.poolType, query.selectionCode));
  });
  app.get('/api/v1/races/:raceId/my-bets', async (request) => {
    const { raceId } = raceIdParamsSchema.parse(request.params);
    const session = await authenticate(request, { raceId });
    return envelope(viewerStore.getMyBets(raceId, session.discordUserId));
  });
  app.get('/api/v1/races/:raceId/result', async (request) => {
    const { raceId } = raceIdParamsSchema.parse(request.params);
    await authenticate(request, { raceId });
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
    const { raceId } = raceIdParamsSchema.parse(request.params);
    const session = await authenticate(request, { csrf: true, raceId });
    const viewingWindow = assertRaceViewingAvailable(activityStore, raceId);
    const privateKey = dependencies.environment.EDGE_TOKEN_PRIVATE_KEY;
    const guildId = dependencies.environment.DISCORD_GUILD_ID;
    if (privateKey === undefined || guildId === undefined) {
      throw httpError(503, 'EDGE_TOKEN_UNAVAILABLE', 'Edge access is not configured.');
    }
    const nbf = Math.floor(now() / 1000);
    const exp = Math.min(
      Math.floor(viewerStore.getEdgeTokenExpiry(raceId) / 1000),
      Math.floor(viewingWindow.closesAt / 1000),
    );
    if (exp <= nbf) {
      throw httpError(410, 'RACE_VIEWING_UNAVAILABLE', 'This race is no longer available to view.');
    }
    return envelope({
      edgeAccessToken: createEdgeAccessToken(
        {
          raceId,
          discordUserId: session.discordUserId,
          guildId,
          nbf,
          exp,
          jti: createOpaqueToken(),
        },
        privateKey,
      ),
    });
  });
}

function assertRaceViewingAvailable(
  activityStore: ServerRouteContext['activityStore'],
  raceId: string,
): ReturnType<ServerRouteContext['activityStore']['assertRaceViewingAvailable']> {
  try {
    return activityStore.assertRaceViewingAvailable(raceId);
  } catch (error) {
    if (error instanceof Error && error.message === 'Activity race is no longer available.') {
      throw httpError(410, 'RACE_VIEWING_UNAVAILABLE', 'This race is no longer available to view.');
    }
    throw error;
  }
}
