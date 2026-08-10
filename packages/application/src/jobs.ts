import type { Timestamp } from '@jcb/domain';
import { z } from 'zod';

export const JOB_TYPES = [
  'warn_missing_race',
  'simulate_race',
  'publish_race',
  'grant_relief',
  'refresh_race_message',
  'open_viewer',
  'close_betting',
  'mark_running',
  'mark_finished',
  'settle_race',
  'refresh_rankings',
  'backup_check',
  'economic_integrity_check',
] as const;

export type JobType = (typeof JOB_TYPES)[number];
export type JobStatus = 'pending' | 'running' | 'completed' | 'retry_wait' | 'dead_letter';

export const jobPayloadSchema = z.record(z.string(), z.unknown());
export type JobPayload = z.infer<typeof jobPayloadSchema>;

export interface ScheduledJob {
  readonly id: string;
  readonly jobType: JobType;
  readonly deduplicationKey: string;
  readonly payload: JobPayload;
  readonly runAt: Timestamp;
  readonly status: JobStatus;
  readonly attemptCount: number;
}

export interface EnqueueJob {
  readonly jobType: JobType;
  readonly deduplicationKey: string;
  readonly payload: JobPayload;
  readonly runAt: Timestamp;
}

export interface JobStore {
  enqueue(job: EnqueueJob): ScheduledJob;
  claimDue(now: Timestamp, workerId: string): ScheduledJob | undefined;
  complete(jobId: string, workerId: string, now: Timestamp): void;
  fail(
    jobId: string,
    workerId: string,
    now: Timestamp,
    errorCode: string,
    redactedMessage: string,
  ): JobStatus;
  reclaimStale(now: Timestamp, staleAfterMilliseconds: number): number;
}

export type JobHandlers = Readonly<Record<string, (job: ScheduledJob) => Promise<void>>>;

export async function runClaimedJob(
  store: JobStore,
  handlers: JobHandlers,
  job: ScheduledJob,
  workerId: string,
  now: Timestamp,
): Promise<JobStatus> {
  const handler = handlers[job.jobType];
  if (handler === undefined) {
    return store.fail(job.id, workerId, now, 'JOB_HANDLER_MISSING', 'No handler is registered.');
  }
  try {
    await handler(job);
    store.complete(job.id, workerId, now);
    return 'completed';
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Unknown job error';
    return store.fail(job.id, workerId, now, 'JOB_FAILED', message);
  }
}
