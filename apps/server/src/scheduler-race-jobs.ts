import { type RaceRecord, type SqliteDatabase, type SqliteJobStore } from '@jcb/database';
import { timestamp, type Timestamp } from '@jcb/domain';

interface PreparedRaceTimingRow {
  readonly timelineDurationMs: bigint | null;
  readonly officialStatus: string | null;
  readonly oddsStatus: string | null;
}

export function loadPreparedRaceTiming(
  database: SqliteDatabase,
  raceId: string,
  raceVersion: number,
): { readonly timelineDurationMs: number } | undefined {
  const row = database
    .prepare(
      `SELECT r.timeline_duration_ms AS timelineDurationMs,
              (SELECT status FROM race_simulations
               WHERE race_id = r.id AND race_version = r.version AND kind = 'official')
                AS officialStatus,
              (SELECT status FROM race_simulations
               WHERE race_id = r.id AND race_version = r.version AND kind = 'odds')
                AS oddsStatus
       FROM races r
       WHERE r.id = ? AND r.version = ?`,
    )
    .get(raceId, raceVersion) as PreparedRaceTimingRow | undefined;
  if (
    row === undefined ||
    row.timelineDurationMs === null ||
    row.officialStatus !== 'completed' ||
    row.oddsStatus !== 'completed'
  ) {
    return undefined;
  }
  const timelineDurationMs = Number(row.timelineDurationMs);
  if (!Number.isSafeInteger(timelineDurationMs) || timelineDurationMs <= 0) {
    throw new Error('Prepared race timeline duration is invalid.');
  }
  return { timelineDurationMs };
}

export function enqueueRaceFollowUpJobs(
  jobStore: SqliteJobStore,
  race: RaceRecord,
  timelineDurationMs: number,
  runAt: Timestamp,
): void {
  const jobs = [
    {
      jobType: 'publish_race' as const,
      deduplicationKey: `publish:${race.id}:${String(race.version)}`,
      runAt,
    },
    {
      jobType: 'grant_relief' as const,
      deduplicationKey: `relief:${race.raceDate}`,
      runAt,
    },
    {
      jobType: 'open_viewer' as const,
      deduplicationKey: `open-viewer:${race.id}:${String(race.version)}`,
      runAt: race.viewerOpensAt,
    },
    {
      jobType: 'close_betting' as const,
      deduplicationKey: `close:${race.id}:${String(race.version)}`,
      runAt: race.bettingClosesAt,
    },
    {
      jobType: 'mark_running' as const,
      deduplicationKey: `running:${race.id}:${String(race.version)}`,
      runAt: race.scheduledAt,
    },
    {
      jobType: 'mark_finished' as const,
      deduplicationKey: `finished:${race.id}:${String(race.version)}`,
      runAt: timestamp(race.scheduledAt + timelineDurationMs),
    },
    {
      jobType: 'settle_race' as const,
      deduplicationKey: `settle:${race.id}:${String(race.version)}`,
      runAt: timestamp(race.scheduledAt + timelineDurationMs + 3_000),
    },
  ];
  for (const job of jobs) {
    const existing = jobStore.getByDeduplicationKey(job.deduplicationKey);
    if (existing !== undefined) continue;
    jobStore.enqueue({
      jobType: job.jobType,
      deduplicationKey: job.deduplicationKey,
      payload: job.jobType === 'grant_relief' ? {} : { raceId: race.id, raceVersion: race.version },
      runAt: job.runAt,
    });
  }
}
