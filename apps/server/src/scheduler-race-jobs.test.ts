import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, openDatabase, SqliteJobStore, type RaceRecord } from '@jcb/database';
import { timestamp } from '@jcb/domain';
import { describe, expect, it } from 'vitest';
import { enqueueRaceFollowUpJobs } from './scheduler-race-jobs.js';

const repositoryRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

describe('race follow-up jobs', () => {
  it('schedules one five-minute reminder per race version', () => {
    const database = openDatabase(':memory:');
    const now = timestamp(1_800_000_000_000);
    applyMigrations(database, join(repositoryRoot, 'packages', 'database', 'migrations'), now);
    const jobs = new SqliteJobStore(
      database,
      () => 0.5,
      () => now,
    );
    const race: RaceRecord = {
      id: 'race-1',
      raceDate: '2026-08-12',
      name: '通知確認',
      kind: 'regular',
      status: 'betting_open',
      version: 2,
      distanceM: 1_200,
      surface: 'turf',
      scheduledAt: timestamp(Number(now) + 600_000),
      bettingOpensAt: timestamp(Number(now) + 100_000),
      bettingClosesAt: timestamp(Number(now) + 500_000),
      viewerOpensAt: timestamp(Number(now) + 400_000),
    };

    try {
      enqueueRaceFollowUpJobs(jobs, race, 120_000, now);
      enqueueRaceFollowUpJobs(jobs, race, 120_000, now);

      const reminder = jobs.getByDeduplicationKey('notify-race-start:race-1:2');
      expect(reminder).toMatchObject({
        jobType: 'notify_race_start',
        runAt: timestamp(Number(race.scheduledAt) - 300_000),
        payload: { raceId: 'race-1', raceVersion: 2 },
      });
      expect(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM scheduled_jobs WHERE deduplication_key = 'notify-race-start:race-1:2'",
          )
          .get(),
      ).toEqual({ count: 1n });
    } finally {
      database.close();
    }
  });
});
