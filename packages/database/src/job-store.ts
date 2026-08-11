import type Database from 'better-sqlite3';
import {
  JOB_TYPES,
  jobPayloadSchema,
  type EnqueueJob,
  type JobStatus,
  type JobStore,
  type JobType,
  type ScheduledJob,
} from '@jcb/application';
import { DomainError, timestamp, type Timestamp } from '@jcb/domain';
import { ulid } from 'ulid';

interface JobRow {
  readonly id: string;
  readonly jobType: string;
  readonly deduplicationKey: string;
  readonly payloadJson: string;
  readonly runAt: bigint;
  readonly status: JobStatus;
  readonly attemptCount: bigint;
}

const MAX_ATTEMPTS: Readonly<Record<JobType, number>> = {
  warn_missing_race: 5,
  simulate_race: 3,
  publish_race: 6,
  grant_relief: 5,
  refresh_race_message: 8,
  open_viewer: 8,
  close_betting: 10,
  mark_running: 10,
  mark_finished: 10,
  settle_race: 10,
  refresh_rankings: 8,
  backup_check: 5,
  economic_integrity_check: 5,
};

export class SqliteJobStore implements JobStore {
  public constructor(
    private readonly database: Database.Database,
    private readonly jitter: () => number,
    private readonly now: () => number = Date.now,
  ) {}

  public enqueue(job: EnqueueJob): ScheduledJob {
    jobPayloadSchema.parse(job.payload);
    const id = ulid();
    const createdAt = BigInt(this.now());
    this.database
      .prepare(
        `INSERT OR IGNORE INTO scheduled_jobs
         (id, job_type, deduplication_key, payload_json, run_at, status, attempt_count,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(
        id,
        job.jobType,
        job.deduplicationKey,
        JSON.stringify(job.payload),
        BigInt(job.runAt),
        createdAt,
        createdAt,
      );
    const persisted = this.getByDeduplicationKey(job.deduplicationKey);
    if (persisted === undefined) throw new Error('Job could not be enqueued.');
    if (
      persisted.jobType !== job.jobType ||
      persisted.runAt !== job.runAt ||
      canonicalJson(persisted.payload) !== canonicalJson(job.payload)
    ) {
      throw new DomainError(
        'DUPLICATE_OPERATION',
        'Deduplication key was already used for a different scheduled job.',
      );
    }
    return persisted;
  }

  public getByDeduplicationKey(deduplicationKey: string): ScheduledJob | undefined {
    const row = this.database
      .prepare(
        `SELECT id, job_type AS jobType, deduplication_key AS deduplicationKey,
                payload_json AS payloadJson, run_at AS runAt, status,
                attempt_count AS attemptCount
         FROM scheduled_jobs WHERE deduplication_key = ?`,
      )
      .get(deduplicationKey) as JobRow | undefined;
    if (row === undefined) return undefined;
    return mapJob(row);
  }

  public claimDue(now: Timestamp, workerId: string): ScheduledJob | undefined {
    const claim = this.database.transaction(() => {
      const row = this.database
        .prepare(
          `SELECT id, job_type AS jobType, deduplication_key AS deduplicationKey,
                  payload_json AS payloadJson, run_at AS runAt, status,
                  attempt_count AS attemptCount
           FROM scheduled_jobs
           WHERE status IN ('pending', 'retry_wait') AND run_at <= ?
           ORDER BY run_at, id
           LIMIT 1`,
        )
        .get(BigInt(now)) as JobRow | undefined;
      if (row === undefined) return undefined;
      const update = this.database
        .prepare(
          `UPDATE scheduled_jobs
           SET status = 'running', attempt_count = attempt_count + 1,
               locked_at = ?, locked_by = ?, updated_at = ?
           WHERE id = ? AND status IN ('pending', 'retry_wait')`,
        )
        .run(BigInt(now), workerId, BigInt(now), row.id);
      if (update.changes !== 1) return undefined;
      return mapJob({ ...row, status: 'running', attemptCount: row.attemptCount + 1n });
    });
    return claim.immediate();
  }

  public complete(jobId: string, workerId: string, now: Timestamp): void {
    const result = this.database
      .prepare(
        `UPDATE scheduled_jobs
         SET status = 'completed', locked_at = NULL, locked_by = NULL, updated_at = ?
         WHERE id = ? AND status = 'running' AND locked_by = ?`,
      )
      .run(BigInt(now), jobId, workerId);
    if (result.changes !== 1) throw new Error('Job completion lost its lock.');
  }

  public fail(
    jobId: string,
    workerId: string,
    now: Timestamp,
    errorCode: string,
    redactedMessage: string,
  ): JobStatus {
    const row = this.database
      .prepare(
        `SELECT id, job_type AS jobType, deduplication_key AS deduplicationKey,
                payload_json AS payloadJson, run_at AS runAt, status,
                attempt_count AS attemptCount
         FROM scheduled_jobs WHERE id = ? AND status = 'running' AND locked_by = ?`,
      )
      .get(jobId, workerId) as JobRow | undefined;
    if (row === undefined) throw new Error('Job failure lost its lock.');
    const jobType = parseJobType(row.jobType);
    const isDeadLetter = Number(row.attemptCount) >= MAX_ATTEMPTS[jobType];
    const status: JobStatus = isDeadLetter ? 'dead_letter' : 'retry_wait';
    const exponent = Math.min(Number(row.attemptCount) - 1, 10);
    const backoff = Math.round(1_000 * 2 ** exponent * (0.75 + this.jitter() * 0.5));
    const nextRunAt = isDeadLetter ? now : timestamp(now + backoff);
    this.database
      .prepare(
        `UPDATE scheduled_jobs
         SET status = ?, run_at = ?, locked_at = NULL, locked_by = NULL,
             last_error_code = ?, last_error_redacted = ?, updated_at = ?
         WHERE id = ? AND status = 'running' AND locked_by = ?`,
      )
      .run(
        status,
        BigInt(nextRunAt),
        errorCode.slice(0, 80),
        redactedMessage.slice(0, 300),
        BigInt(now),
        jobId,
        workerId,
      );
    return status;
  }

  public reclaimStale(now: Timestamp, staleAfterMilliseconds: number): number {
    const cutoff = now - staleAfterMilliseconds;
    const result = this.database
      .prepare(
        `UPDATE scheduled_jobs
         SET status = 'retry_wait', locked_at = NULL, locked_by = NULL,
             run_at = ?, last_error_code = 'STALE_LOCK_RECLAIMED',
             last_error_redacted = 'Worker lock expired after restart.', updated_at = ?
         WHERE status = 'running' AND locked_at < ?`,
      )
      .run(BigInt(now), BigInt(now), BigInt(cutoff));
    return result.changes;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function mapJob(row: JobRow): ScheduledJob {
  return {
    id: row.id,
    jobType: parseJobType(row.jobType),
    deduplicationKey: row.deduplicationKey,
    payload: jobPayloadSchema.parse(JSON.parse(row.payloadJson)),
    runAt: timestamp(Number(row.runAt)),
    status: row.status,
    attemptCount: Number(row.attemptCount),
  };
}

function parseJobType(value: string): JobType {
  if (!JOB_TYPES.includes(value as JobType)) throw new Error(`Unknown job type: ${value}`);
  return value as JobType;
}
