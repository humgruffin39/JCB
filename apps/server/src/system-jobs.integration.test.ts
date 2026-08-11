import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, openDatabase } from '@jcb/database';
import { jstDateTimeToTimestamp, timestamp } from '@jcb/domain';
import { scheduleSystemJobs } from './system-jobs.js';

const repositoryRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

describe('system job scheduling', () => {
  it('reuses catch-up run times when the server restarts', () => {
    const database = openDatabase(':memory:');
    applyMigrations(database, join(repositoryRoot, 'packages', 'database', 'migrations'), 1);
    const firstNow = jstDateTimeToTimestamp('2026-08-11', '16:45:00');
    const secondNow = timestamp(Number(firstNow) + 1_000);

    try {
      scheduleSystemJobs(database, firstNow);
      const first = database
        .prepare(
          `SELECT run_at AS runAt FROM scheduled_jobs
           WHERE deduplication_key = 'economy-integrity:2026-08-11'`,
        )
        .get() as { runAt: bigint } | undefined;
      expect(first?.runAt).toBe(BigInt(firstNow));

      expect(() => scheduleSystemJobs(database, secondNow)).not.toThrow();
      const second = database
        .prepare(
          `SELECT run_at AS runAt FROM scheduled_jobs
           WHERE deduplication_key = 'economy-integrity:2026-08-11'`,
        )
        .get() as { runAt: bigint } | undefined;
      expect(second?.runAt).toBe(first?.runAt);
    } finally {
      database.close();
    }
  });
});
