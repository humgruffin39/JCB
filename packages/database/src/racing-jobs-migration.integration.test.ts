import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';

const migrationsDirectory = join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations');

describe('racing role and reminder migration', () => {
  it('backfills jobs for existing account holders and upcoming races', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'jcb-racing-jobs-'));
    const legacyMigrations = join(temporaryDirectory, 'migrations');
    const database = openDatabase(':memory:');
    try {
      mkdirSync(legacyMigrations);
      for (const file of readdirSync(migrationsDirectory).filter((name) => name < '0023')) {
        cpSync(join(migrationsDirectory, file), join(legacyMigrations, file), {
          recursive: true,
        });
      }
      applyMigrations(database, legacyMigrations, 1);
      database
        .prepare(
          `INSERT INTO users
           (id, discord_user_id, display_name, status, created_at, updated_at, last_guild_check_at)
           VALUES ('user-1', '1539853436823015000', '既存利用者', 'active', 1, 1, 1)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO accounts
           (id, owner_type, owner_key, account_type, created_at)
           VALUES ('account-1', 'user', 'user-1', 'user', 1)`,
        )
        .run();
      const scheduledAt = Date.now() + 60 * 60 * 1_000;
      database
        .prepare(
          `INSERT INTO races
           (id, race_date, name, kind, status, version, distance_m, going, surface,
            scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
            created_at, updated_at)
           VALUES ('race-1', '2026-08-20', '移行試験', 'regular', 'locked', 1, 1200,
                   'firm', 'turf', ?, ?, ?, ?, 1, 1)`,
        )
        .run(
          BigInt(scheduledAt),
          BigInt(scheduledAt - 20 * 60 * 1_000),
          BigInt(scheduledAt - 10 * 60 * 1_000),
          BigInt(scheduledAt - 15 * 60 * 1_000),
        );

      applyMigrations(database, migrationsDirectory, 2);

      expect(
        database
          .prepare(
            `SELECT job_type AS jobType, payload_json AS payloadJson
             FROM scheduled_jobs WHERE deduplication_key = 'grant-racing-role:1539853436823015000'`,
          )
          .get(),
      ).toEqual({
        jobType: 'grant_racing_role',
        payloadJson: '{"discordUserId":"1539853436823015000"}',
      });
      expect(
        database
          .prepare(
            `SELECT job_type AS jobType, run_at AS runAt
             FROM scheduled_jobs WHERE deduplication_key = 'notify-race-start:race-1:1'`,
          )
          .get(),
      ).toEqual({ jobType: 'notify_race_start', runAt: BigInt(scheduledAt - 300_000) });
    } finally {
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
