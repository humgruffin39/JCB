import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrivateObjectStore } from '@jcb/application';
import { parseEnvironment } from '@jcb/config';
import { applyMigrations, openDatabase, SqliteAuthStore, SqliteGameStore } from '@jcb/database';
import { timestamp } from '@jcb/domain';
import { describe, expect, it } from 'vitest';
import { buildServer } from './build-app.js';

const migrationsDirectory = join(
  dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
  'packages',
  'database',
  'migrations',
);

describe('admin race cancellation', () => {
  it('queues versioned Discord cancellation cleanup in the cancellation transaction', async () => {
    const now = 1_800_000_000_000;
    const database = openDatabase(':memory:');
    applyMigrations(database, migrationsDirectory, now);
    const game = new SqliteGameStore(database, () => now);
    game.initializeEconomy(['123456']);
    game.registerUser('123456', '管理者', true);
    const horses = Array.from({ length: 8 }, (_, index) =>
      game.createHorse({
        name: `中止試験馬${String(index + 1)}`,
        status: 'active',
        runningStyle: 'front_runner',
        speed: 50,
        start: 50,
        acceleration: 50,
        stamina: 50,
        lateKick: 50,
        conditionStability: 50,
        distancePreference: 0,
        surfacePreference: 0,
      }),
    );
    const race = game.createRaceDraft({
      raceDate: '2026-08-20',
      name: '中止試験',
      distanceM: 1_200,
      surface: 'turf',
      scheduledAt: timestamp(now + 30_000),
      bettingOpensAt: timestamp(now + 10_000),
      bettingClosesAt: timestamp(now + 20_000),
      viewerOpensAt: timestamp(now + 10_000),
      entries: horses.map((horse, index) => ({ horseId: horse.id, horseNumber: index + 1 })),
    });
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      INITIAL_ADMIN_DISCORD_IDS: '123456',
      SESSION_SECRET: randomBytes(32).toString('base64'),
      DISCORD_GUILD_ID: '123456789',
    });
    const timelineStore: PrivateObjectStore = {
      async put() {
        return;
      },
      async get() {
        return undefined;
      },
      async delete() {
        return;
      },
      async list() {
        return [];
      },
    };
    const app = await buildServer({
      database,
      environment,
      clock: { now: () => timestamp(now) },
      membership: {
        async isCurrentMember() {
          return true;
        },
      },
      timelineStore,
    });
    const session = new SqliteAuthStore(database, () => now).createOAuthSession('123456');
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/races/${race.id}/cancel`,
        headers: {
          cookie: `jcb_session=${session.sessionToken}`,
          'x-csrf-token': session.csrfToken,
        },
        payload: { reason: '運営上の都合' },
      });

      expect(response.statusCode).toBe(200);
      expect(game.getRace(race.id).status).toBe('cancelled');
      const row = database
        .prepare(
          `SELECT job_type AS jobType, deduplication_key AS deduplicationKey,
                  run_at AS runAt, payload_json AS payloadJson
           FROM scheduled_jobs
           WHERE job_type = 'refresh_race_message' AND deduplication_key = ?`,
        )
        .get(`refresh-race:${race.id}:0:cancellation`) as
        | {
            jobType: string;
            deduplicationKey: string;
            runAt: bigint;
            payloadJson: string;
          }
        | undefined;
      expect(row).toMatchObject({
        jobType: 'refresh_race_message',
        deduplicationKey: `refresh-race:${race.id}:0:cancellation`,
        runAt: BigInt(now),
      });
      expect(JSON.parse(row!.payloadJson)).toEqual({
        cancellationCleanup: true,
        raceId: race.id,
        raceVersion: 0,
      });
    } finally {
      await app.close();
      database.close();
    }
  });
});
