import { signReleaseManifest } from '@jcb/application';
import { gameSettingsSchema } from '@jcb/config';
import {
  cancellationSchema,
  createRaceSchema,
  emergencyRevealSchema,
  raceIdParamsSchema,
  racePatchSchema,
  signedManifestSchema,
} from '@jcb/contracts';
import { SqliteObjectPublicationStore, type RaceDraftPatch } from '@jcb/database';
import { timestamp } from '@jcb/domain';
import type { FastifyInstance } from 'fastify';
import {
  envelope,
  findInternalUserId,
  clientAddress,
  hashIp,
  secureRandomUnit,
  httpError,
  withoutUndefined,
} from './server-support.js';
import type { ServerRouteContext } from './server-types.js';

export function registerAdminRaceRoutes(app: FastifyInstance, context: ServerRouteContext): void {
  const {
    dependencies,
    now,
    gameStore,
    adminStore,
    lifecycle,
    jobStore,
    authenticate,
    notifyAdmin,
    sessionSecret,
  } = context;

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
    await notifyAdmin({
      level: 'info',
      title: 'レースの下書きを作成しました',
      description: '開催内容を保存しました。確定するとシミュレーションを予約します。',
      fields: [
        { name: 'レース', value: race.name },
        { name: 'バージョン', value: `v${String(race.version)}`, inline: true },
      ],
    });
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
    const race = dependencies.database
      .transaction(() => {
        const locked = gameStore.lockRace(raceId, secureRandomUnit, {
          conditionProbabilities: settings.conditionProbabilities,
          simulationNoiseStandardDeviation: settings.simulationNoiseStandardDeviation,
          fatigueMaximum: settings.fatigueMaximum,
          seedLiquidityClamp: settings.seedLiquidityClamp,
          raceBetLimits: settings.raceBetLimits,
        });
        jobStore.enqueue({
          jobType: 'simulate_race',
          deduplicationKey: `simulate:${locked.id}:${String(locked.version)}`,
          payload: { raceId: locked.id, raceVersion: locked.version },
          runAt: now(),
        });
        adminStore.recordAudit({
          actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
          action: 'race.locked',
          targetType: 'race',
          targetId: locked.id,
          after: { version: locked.version, inputHash: locked.inputHash },
        });
        return locked;
      })
      .immediate();
    await notifyAdmin({
      level: 'info',
      title: 'レースを確定しました',
      description: 'シミュレーションを予約しました。',
      fields: [
        { name: 'レース', value: race.name },
        { name: 'バージョン', value: `v${String(race.version)}`, inline: true },
      ],
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
    const cancelledAt = now();
    dependencies.database
      .transaction(() => {
        const race = gameStore.getRace(raceId);
        lifecycle.cancelAndRefund(raceId, reason, cancelledAt);
        const cancellationCleanupKey = `refresh-race:${raceId}:${String(race.version)}:cancellation`;
        if (jobStore.getByDeduplicationKey(cancellationCleanupKey) === undefined) {
          jobStore.enqueue({
            jobType: 'refresh_race_message',
            deduplicationKey: cancellationCleanupKey,
            payload: { cancellationCleanup: true, raceId, raceVersion: race.version },
            runAt: cancelledAt,
          });
        }
        jobStore.enqueue({
          jobType: 'refresh_rankings',
          deduplicationKey: `rankings:cancel:${raceId}:${String(cancelledAt)}`,
          payload: { raceId },
          runAt: cancelledAt,
        });
        adminStore.recordAudit({
          actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
          action: 'race.cancelled',
          targetType: 'race',
          targetId: raceId,
          reason,
        });
      })
      .immediate();
    await notifyAdmin({
      level: 'warning',
      title: 'レースを中止しました',
      description: '参加者への投票額は全額返金しました。',
      fields: [
        { name: 'レースID', value: raceId },
        { name: '中止理由', value: reason },
      ],
    });
    return envelope({ cancelled: true });
  });
  app.post('/api/v1/admin/races/:raceId/retry-simulation', async (request) => {
    const session = await authenticate(request, { admin: true, csrf: true });
    const { raceId } = raceIdParamsSchema.parse(request.params);
    const race = gameStore.getRace(raceId);
    const runAt = now();
    const deduplicationKey = `simulate:${raceId}:${String(race.version)}:manual`;
    const existing = jobStore.getByDeduplicationKey(deduplicationKey);
    if (existing === undefined) {
      jobStore.enqueue({
        jobType: 'simulate_race',
        deduplicationKey,
        payload: { raceId, raceVersion: race.version },
        runAt,
      });
    } else if (existing.status === 'retry_wait' || existing.status === 'dead_letter') {
      adminStore.retryJob(existing.id, runAt);
    }
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
    const race = gameStore.getRace(raceId);
    const runAt = now();
    const deduplicationKey = `settle:${raceId}:${String(race.version)}:manual`;
    const existing = jobStore.getByDeduplicationKey(deduplicationKey);
    if (existing === undefined) {
      jobStore.enqueue({
        jobType: 'settle_race',
        deduplicationKey,
        payload: { raceId, raceVersion: race.version },
        runAt,
      });
    } else if (existing.status === 'retry_wait' || existing.status === 'dead_letter') {
      adminStore.retryJob(existing.id, runAt);
    }
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
         FROM races WHERE id = ? AND status = 'betting_open'`,
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
    const scheduledAt = timestamp(runAt + 60_000);
    const timelineDurationMs = Number(timing.timelineDurationMs);
    if (!Number.isSafeInteger(timelineDurationMs) || timelineDurationMs <= 0) {
      throw httpError(409, 'RACE_NOT_PREPARED', 'The race timeline duration is invalid.');
    }
    const finishAt = timestamp(scheduledAt + timelineDurationMs);
    const settlementAt = timestamp(finishAt + 3_000);
    if (
      dependencies.timelineStore === undefined ||
      dependencies.environment.MANIFEST_PRIVATE_KEY === undefined
    ) {
      throw httpError(
        503,
        'REHEARSAL_PUBLISHING_UNAVAILABLE',
        'Rehearsal publishing is not configured.',
      );
    }
    const stored = await dependencies.timelineStore.get(`race-manifests/${raceId}.json`);
    if (stored === undefined) {
      throw httpError(409, 'RACE_MANIFEST_UNAVAILABLE', 'The race release manifest is missing.');
    }
    let manifestPublication: Uint8Array;
    try {
      const signed = signedManifestSchema.parse(JSON.parse(Buffer.from(stored).toString('utf8')));
      manifestPublication = Buffer.from(
        JSON.stringify(
          signReleaseManifest(
            { ...signed.manifest, scheduledStart: scheduledAt, viewerOpensAt: runAt },
            dependencies.environment.MANIFEST_PRIVATE_KEY,
          ),
        ),
        'utf8',
      );
    } catch {
      throw httpError(409, 'RACE_MANIFEST_INVALID', 'The race release manifest is invalid.');
    }
    const manifestKey = `race-manifests/${raceId}.json`;
    const manifestMetadata = { raceId, type: 'release-manifest' };
    const run = dependencies.database.transaction(() => {
      dependencies.database
        .prepare(
          'UPDATE races SET scheduled_at = ?, betting_opens_at = ?, betting_closes_at = ?, viewer_opens_at = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          BigInt(scheduledAt),
          BigInt(runAt - 1_000),
          BigInt(runAt),
          BigInt(runAt),
          BigInt(runAt),
          raceId,
        );
      lifecycle.closeBetting(raceId, timestamp(runAt));
      lifecycle.markReady(raceId);
      const raceVersion = String(race.version);
      dependencies.database
        .prepare(
          `UPDATE scheduled_jobs
           SET status = 'completed', locked_at = NULL, locked_by = NULL, updated_at = ?
           WHERE job_type IN ('publish_race', 'refresh_race_message', 'open_viewer',
                              'notify_race_start', 'close_betting', 'mark_running',
                              'mark_finished', 'settle_race')
             AND status IN ('pending', 'retry_wait', 'dead_letter')
             AND json_extract(payload_json, '$.raceId') = ?
             AND (
               json_extract(payload_json, '$.raceVersion') = ?
               OR json_extract(payload_json, '$.raceVersion') IS NULL
             )`,
        )
        .run(BigInt(runAt), raceId, race.version);
      new SqliteObjectPublicationStore(dependencies.database).replace(
        manifestKey,
        manifestPublication,
        manifestMetadata,
        runAt,
      );
      jobStore.enqueue({
        jobType: 'publish_race',
        deduplicationKey: `publish:${raceId}:rehearsal:${String(runAt)}`,
        payload: { raceId, raceVersion: race.version },
        runAt,
      });
      jobStore.enqueue({
        jobType: 'open_viewer',
        deduplicationKey: `open-viewer:${raceId}:${raceVersion}:rehearsal:${String(runAt)}`,
        payload: { raceId, raceVersion: race.version },
        runAt,
      });
      jobStore.enqueue({
        jobType: 'mark_running',
        deduplicationKey: `running:${raceId}:${raceVersion}:rehearsal:${String(runAt)}`,
        payload: { raceId, raceVersion: race.version },
        runAt: scheduledAt,
      });
      jobStore.enqueue({
        jobType: 'mark_finished',
        deduplicationKey: `finished:${raceId}:${raceVersion}:rehearsal:${String(runAt)}`,
        payload: { raceId, raceVersion: race.version },
        runAt: finishAt,
      });
      jobStore.enqueue({
        jobType: 'settle_race',
        deduplicationKey: `settle:${raceId}:${raceVersion}:rehearsal:${String(runAt)}`,
        payload: { raceId, raceVersion: race.version },
        runAt: settlementAt,
      });
      adminStore.recordAudit({
        actorUserId: findInternalUserId(dependencies.database, session.discordUserId),
        action: 'race.rehearsal_scheduled',
        targetType: 'race',
        targetId: raceId,
      });
    });
    run.immediate();
    // Commit the durable schedule and outbox first. If direct publication fails,
    // the scheduler can still deliver the exact same manifest from the outbox.
    try {
      await dependencies.timelineStore.put(manifestKey, manifestPublication, manifestMetadata);
    } catch (error) {
      request.log.error({ err: error, raceId }, 'immediate rehearsal manifest publication failed');
    }
    return envelope({
      scheduled: true,
      viewerOpensAt: runAt,
      scheduledAt,
      finishAt,
      settlementAt,
    });
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
      ipHash: hashIp(clientAddress(request), sessionSecret),
    });
    await notifyAdmin({
      level: 'error',
      title: '緊急結果閲覧を実行しました',
      description: '通常の公開前に、管理者がレース結果を確認しました。',
      fields: [
        { name: 'レースID', value: raceId },
        { name: '確認理由', value: body.reason },
      ],
    });
    return envelope(result);
  });
}
