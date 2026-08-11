import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timestamp } from '@jcb/domain';
import { openDatabase } from './connection.js';
import { SqliteJobStore } from './job-store.js';
import { applyMigrations } from './migrations.js';

function createStore(): { database: ReturnType<typeof openDatabase>; store: SqliteJobStore } {
  const database = openDatabase(':memory:');
  applyMigrations(
    database,
    join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
    1,
  );
  return { database, store: new SqliteJobStore(database, () => 0.5) };
}

describe('SQLite job store', () => {
  it('records enqueue time separately from the scheduled run time', () => {
    const { database } = createStore();
    const store = new SqliteJobStore(
      database,
      () => 0.5,
      () => 123,
    );
    store.enqueue({
      jobType: 'backup_check',
      deduplicationKey: 'created-at-check',
      payload: {},
      runAt: timestamp(9_999),
    });
    const row = database
      .prepare(
        'SELECT run_at AS runAt, created_at AS createdAt, updated_at AS updatedAt FROM scheduled_jobs',
      )
      .get() as { runAt: bigint; createdAt: bigint; updatedAt: bigint };
    expect(row).toEqual({ runAt: 9_999n, createdAt: 123n, updatedAt: 123n });
    database.close();
  });

  it('rejects conflicting reuse of a job deduplication key', () => {
    const { database, store } = createStore();
    store.enqueue({
      jobType: 'settle_race',
      deduplicationKey: 'settle:conflict',
      payload: { raceId: 'race-a' },
      runAt: timestamp(100),
    });
    expect(() =>
      store.enqueue({
        jobType: 'settle_race',
        deduplicationKey: 'settle:conflict',
        payload: { raceId: 'race-b' },
        runAt: timestamp(100),
      }),
    ).toThrow(/different scheduled job/i);
    database.close();
  });

  it('claims a due job after the database process restarts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jcb-job-restart-'));
    const databasePath = join(directory, 'jobs.sqlite');
    let database = openDatabase(databasePath);
    try {
      applyMigrations(
        database,
        join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
        1,
      );
      new SqliteJobStore(database, () => 0.5).enqueue({
        jobType: 'settle_race',
        deduplicationKey: 'settle:restart-race',
        payload: { raceId: 'restart-race' },
        runAt: timestamp(100),
      });
      database.close();

      database = openDatabase(databasePath);
      const resumed = new SqliteJobStore(database, () => 0.5).claimDue(
        timestamp(100),
        'restarted-worker',
      );
      expect(resumed?.payload).toEqual({ raceId: 'restart-race' });
    } finally {
      if (database.open) database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('prevents double claims and resumes after a stale worker lock', () => {
    const { database, store } = createStore();
    store.enqueue({
      jobType: 'settle_race',
      deduplicationKey: 'settle:race-1',
      payload: { raceId: 'race-1' },
      runAt: timestamp(100),
    });
    const first = store.claimDue(timestamp(100), 'worker-a');
    expect(first).toBeDefined();
    expect(store.claimDue(timestamp(100), 'worker-b')).toBeUndefined();
    expect(store.reclaimStale(timestamp(10_000), 5_000)).toBe(1);
    const resumed = store.claimDue(timestamp(10_000), 'worker-b');
    expect(resumed?.id).toBe(first?.id);
    expect(() => store.complete(first!.id, 'worker-a', timestamp(10_001))).toThrow(
      /lost its lock/i,
    );
    expect(() => store.fail(first!.id, 'worker-a', timestamp(10_001), 'STALE', 'stale')).toThrow(
      /lost its lock/i,
    );
    expect(
      database
        .prepare('SELECT status, locked_by AS lockedBy FROM scheduled_jobs WHERE id = ?')
        .get(first!.id),
    ).toEqual({ status: 'running', lockedBy: 'worker-b' });
    database.close();
  });

  it('reports failure when the lease is lost before the failure update', () => {
    let leaseRevoked = false;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      1,
    );
    const store = new SqliteJobStore(database, () => {
      leaseRevoked = true;
      database
        .prepare(
          `UPDATE scheduled_jobs SET status = 'retry_wait', locked_at = NULL, locked_by = NULL
           WHERE deduplication_key = 'simulate:failure-race'`,
        )
        .run();
      return 0.5;
    });
    const queued = store.enqueue({
      jobType: 'simulate_race',
      deduplicationKey: 'simulate:failure-race',
      payload: { raceId: 'race-1' },
      runAt: timestamp(100),
    });
    const jobId = store.claimDue(timestamp(100), 'worker')?.id;
    expect(jobId).toBe(queued.id);
    expect(() => store.fail(jobId!, 'worker', timestamp(100), 'TEST', 'redacted')).toThrow(
      /lost its lock/i,
    );
    expect(leaseRevoked).toBe(true);
    expect(
      database
        .prepare('SELECT status, locked_by AS lockedBy FROM scheduled_jobs WHERE id = ?')
        .get(jobId),
    ).toEqual({ status: 'running', lockedBy: 'worker' });
    database.close();
  });

  it('moves a repeatedly failing job to dead letter', () => {
    const { database, store } = createStore();
    store.enqueue({
      jobType: 'simulate_race',
      deduplicationKey: 'simulate:race-1',
      payload: { raceId: 'race-1' },
      runAt: timestamp(100),
    });
    let now = 100;
    let status = 'pending';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const job = store.claimDue(timestamp(now), 'worker');
      expect(job).toBeDefined();
      status = store.fail(job!.id, 'worker', timestamp(now), 'TEST', 'redacted');
      now += 10_000;
    }
    expect(status).toBe('dead_letter');
    database.close();
  });
});
