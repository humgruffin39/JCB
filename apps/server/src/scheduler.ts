import { runClaimedJob } from '@jcb/application';
import {
  SqliteAdminStore,
  SqliteJobStore,
  SqliteMaintenanceStore,
  SqliteObjectPublicationStore,
  publishPendingObjects,
} from '@jcb/database';
import { randomUUID } from 'node:crypto';
import { createHandlers } from './scheduler-handlers.js';
import {
  cleanupOrphanedTimelineObjects,
  repairMissingPublishedObjects,
} from './scheduler-maintenance.js';
import { cryptoJitter, formatJobType, sendAdminNotice } from './scheduler-support.js';
import type { SchedulerDependencies } from './scheduler-types.js';

export type {
  MissingPublishedObjectRepairResult,
  SchedulerDependencies,
} from './scheduler-types.js';
export {
  cleanupOrphanedTimelineObjects,
  repairMissingPublishedObjects,
} from './scheduler-maintenance.js';
export { verifyBackupProbe } from './scheduler-backup.js';

const POLL_INTERVAL_MILLISECONDS = 30_000;
const STALE_LOCK_MILLISECONDS = 5 * 60 * 1000;

export function startScheduler(dependencies: SchedulerDependencies): () => Promise<void> {
  const workerId = `server:${process.pid.toString()}:${randomUUID()}`;
  const jobStore = new SqliteJobStore(dependencies.database, cryptoJitter, () =>
    dependencies.clock.now(),
  );
  const schedulerAdminStore = new SqliteAdminStore(dependencies.database, () =>
    dependencies.clock.now(),
  );
  jobStore.reclaimStale(dependencies.clock.now(), STALE_LOCK_MILLISECONDS);
  const handlers = createHandlers(dependencies, jobStore);
  const publications = new SqliteObjectPublicationStore(dependencies.database);
  const maintenance = new SqliteMaintenanceStore(dependencies.database);
  publications.reclaimStale(dependencies.clock.now(), STALE_LOCK_MILLISECONDS);
  let nextMaintenanceAt = 0;
  let isPolling = false;
  const missingPublicationAlerts = new Set<string>();

  const publishObjects = async (): Promise<void> => {
    const result = await publishPendingObjects(
      publications,
      dependencies.timelineStore,
      `${workerId}:objects`,
      () => dependencies.clock.now(),
    );
    if (result.failed > 0) {
      dependencies.onError?.(
        new Error(
          `${String(result.failed)} object publication(s) failed; ${String(result.deadLettered)} moved to dead-letter.`,
        ),
      );
    }
    if (result.deadLettered > 0) {
      schedulerAdminStore.recordAudit({
        action: 'object_publication.dead_lettered',
        targetType: 'object_publication',
        targetId: 'batch',
        reason: `${String(result.deadLettered)} object publication(s) exhausted their retry policy.`,
        after: { count: result.deadLettered },
      });
      await sendAdminNotice(dependencies, {
        level: 'error',
        title: '公開データを配信できませんでした',
        description: '再試行上限に達した公開処理があります。管理画面から再試行してください。',
        fields: [{ name: '停止した公開処理', value: String(result.deadLettered) }],
      });
    }
  };

  const poll = async (): Promise<void> => {
    if (isPolling) return;
    isPolling = true;
    try {
      const maintenanceNow = dependencies.clock.now();
      schedulerAdminStore.probeDatabaseReadWrite();
      jobStore.reclaimStale(maintenanceNow, STALE_LOCK_MILLISECONDS);
      publications.reclaimStale(maintenanceNow, STALE_LOCK_MILLISECONDS);
      if (dependencies.clock.now() >= nextMaintenanceAt) {
        maintenance.cleanup(dependencies.clock.now());
        try {
          const repair = await repairMissingPublishedObjects(
            dependencies.database,
            dependencies.timelineStore,
            dependencies.clock.now(),
          );
          for (const key of [...missingPublicationAlerts]) {
            if (!repair.unrecoverable.includes(key)) missingPublicationAlerts.delete(key);
          }
          const newlyUnrecoverable = repair.unrecoverable.filter(
            (key) => !missingPublicationAlerts.has(key),
          );
          for (const key of repair.unrecoverable) missingPublicationAlerts.add(key);
          if (repair.requeued.length > 0) {
            schedulerAdminStore.recordAudit({
              action: 'object_publication.repaired',
              targetType: 'object_publication',
              targetId: 'batch',
              reason: 'Missing published objects were restored from the durable outbox.',
              after: { keys: repair.requeued },
            });
          }
          if (newlyUnrecoverable.length > 0) {
            const reason = `Missing published objects have no durable outbox record: ${newlyUnrecoverable.join(', ')}`;
            dependencies.onError?.(new Error(reason));
            schedulerAdminStore.recordAudit({
              action: 'object_publication.repair_failed',
              targetType: 'object_publication',
              targetId: 'batch',
              reason,
              after: { keys: newlyUnrecoverable },
            });
            await sendAdminNotice(dependencies, {
              level: 'error',
              title: '公開データを復元できませんでした',
              description:
                '観戦データまたは公開マニフェストが見つからず、再公開用データもありません。',
              fields: [{ name: '対象', value: newlyUnrecoverable.join('\n') }],
            });
          }
          await cleanupOrphanedTimelineObjects(
            dependencies.database,
            dependencies.timelineStore,
            dependencies.clock.now(),
          );
        } catch (error) {
          dependencies.onError?.(error);
        }
        nextMaintenanceAt = dependencies.clock.now() + 60 * 60 * 1_000;
      }
      await publishObjects();
      schedulerAdminStore.recordSystemSetting(
        'scheduler_heartbeat_at',
        new Date(dependencies.clock.now()).toISOString(),
      );
      for (let processed = 0; processed < 20; processed += 1) {
        const now = dependencies.clock.now();
        const job = jobStore.claimDue(now, workerId);
        if (job === undefined) break;
        const status = await runClaimedJob(jobStore, handlers, job, workerId, () =>
          dependencies.clock.now(),
        );
        if (status === 'dead_letter') {
          const adminStore = new SqliteAdminStore(dependencies.database, () =>
            dependencies.clock.now(),
          );
          adminStore.recordAudit({
            action: 'job.dead_lettered',
            targetType: 'scheduled_job',
            targetId: job.id,
            reason: `${job.jobType} exhausted its retry policy.`,
          });
          await sendAdminNotice(dependencies, {
            level: 'error',
            title: '自動処理を完了できませんでした',
            description: '再試行上限に達したため、処理を停止しました。',
            fields: [
              { name: '処理', value: formatJobType(job.jobType) },
              { name: 'ジョブID', value: job.id },
            ],
          });
        }
      }
      await publishObjects();
    } finally {
      isPolling = false;
    }
  };
  const runPoll = (): void => {
    if (activePoll !== undefined) return;
    const currentPoll = poll().catch((error: unknown) => {
      if (dependencies.onError !== undefined) dependencies.onError(error);
      else process.emitWarning(error instanceof Error ? error : String(error));
    });
    activePoll = currentPoll;
    void currentPoll.then(
      () => {
        if (activePoll === currentPoll) activePoll = undefined;
      },
      () => {
        if (activePoll === currentPoll) activePoll = undefined;
      },
    );
  };
  let activePoll: Promise<void> | undefined;
  runPoll();
  const interval = setInterval(runPoll, POLL_INTERVAL_MILLISECONDS);
  interval.unref();
  return async () => {
    clearInterval(interval);
    await activePoll;
  };
}
