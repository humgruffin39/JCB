import { horseInputSchema, horsePatchSchema } from '@jcb/contracts';
import type { HorseWrite } from '@jcb/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { envelope, findOptionalInternalUserId, withoutUndefined } from './server-support.js';
import type { ServerRouteContext } from './server-types.js';

export function registerAdminHorseRoutes(app: FastifyInstance, context: ServerRouteContext): void {
  const { dependencies, gameStore, adminStore, authenticate } = context;

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
}
