import { gameSettingsSchema } from '@jcb/config';
import { adminAdjustmentSchema, jobIdParamsSchema } from '@jcb/contracts';
import { SqliteObjectPublicationStore } from '@jcb/database';
import type { FastifyInstance } from 'fastify';
import { ODDS_VERSION } from '@jcb/odds';
import { SIMULATION_VERSION } from '@jcb/simulation';
import { z } from 'zod';
import {
  envelope,
  findInternalUserId,
  httpError,
  rescheduleMissingRaceWarnings,
} from './server-support.js';
import type { ServerRouteContext } from './server-types.js';

export function registerAdminOperationsRoutes(
  app: FastifyInstance,
  context: ServerRouteContext,
): void {
  const { dependencies, now, adminStore, jobStore, authenticate } = context;

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
    const transactionId = dependencies.database
      .transaction(() => {
        const adjusted = adminStore.adjustBalance({
          targetAccountId: body.accountId,
          signedAmount: BigInt(body.amount),
          reason: body.reason,
          idempotencyKey: body.idempotencyKey,
          actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
        });
        jobStore.enqueue({
          jobType: 'refresh_rankings',
          deduplicationKey: `rankings:adjustment:${adjusted}`,
          payload: {},
          runAt: now(),
        });
        return adjusted;
      })
      .immediate();
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
  app.post('/api/v1/admin/object-publications/:publicationId/retry', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const { publicationId } = z
      .object({ publicationId: z.string().min(1).max(80) })
      .parse(request.params);
    new SqliteObjectPublicationStore(dependencies.database).retryDeadLetter(publicationId, now());
    adminStore.recordAudit({
      actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
      action: 'object_publication.retry_queued',
      targetType: 'object_publication',
      targetId: publicationId,
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
    if (discordUserId === session.discordUserId) {
      throw httpError(
        403,
        'ADMIN_SELF_REMOVAL_FORBIDDEN',
        'Administrators cannot remove themselves.',
      );
    }
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
}
