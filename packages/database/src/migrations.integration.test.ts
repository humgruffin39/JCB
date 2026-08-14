import { appendFileSync, cpSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';

describe('database migrations', () => {
  it('keeps race foreign keys valid while allowing multiple races on one date', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jcb-migrations-'));
    const source = join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations');
    const migrations = join(directory, 'migrations');
    const multipleRaceMigration = '0020_allow_multiple_races_per_day.sql';
    cpSync(source, migrations, { recursive: true });
    unlinkSync(join(migrations, multipleRaceMigration));
    const database = openDatabase(':memory:');
    try {
      applyMigrations(database, migrations, 1);
      database
        .prepare(
          `INSERT INTO races
           (id, race_date, name, kind, status, version, distance_m, going,
            scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
            created_at, updated_at)
           VALUES ('race-before-migration', '2026-08-14', '移行前', 'regular', 'draft', 0,
                   1200, 'firm', 100000, 80000, 90000, 70000, 1, 1)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO web_login_tickets
           (id, token_hash, discord_user_id, race_id, expires_at, created_at)
           VALUES ('ticket-1', 'hash-1', 'user-1', 'race-before-migration', 200000, 1)`,
        )
        .run();
      cpSync(join(source, multipleRaceMigration), join(migrations, multipleRaceMigration));
      applyMigrations(database, migrations, 2);
      expect(database.pragma('foreign_keys', { simple: true })).toBe(1n);
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(
        database
          .prepare('SELECT race_id AS raceId FROM web_login_tickets WHERE id = ?')
          .get('ticket-1'),
      ).toEqual({ raceId: 'race-before-migration' });
      expect(() =>
        database
          .prepare(
            `INSERT INTO races
             (id, race_date, name, kind, status, version, distance_m, going,
              scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
              created_at, updated_at)
             VALUES ('race-after-migration', '2026-08-14', '移行後', 'regular', 'draft', 0,
                     1200, 'firm', 200000, 180000, 190000, 170000, 2, 2)`,
          )
          .run(),
      ).not.toThrow();
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('detects modification of an already-applied migration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jcb-migrations-'));
    const source = join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations');
    const migrations = join(directory, 'migrations');
    cpSync(source, migrations, { recursive: true });
    const database = openDatabase(':memory:');
    try {
      applyMigrations(database, migrations, 1);
      appendFileSync(join(migrations, '0012_object_publication_outbox.sql'), '\n-- modified\n');
      expect(() => applyMigrations(database, migrations, 2)).toThrow(/checksum mismatch/i);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('detects removal of an already-applied migration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jcb-migrations-'));
    const source = join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations');
    const migrations = join(directory, 'migrations');
    cpSync(source, migrations, { recursive: true });
    const database = openDatabase(':memory:');
    try {
      applyMigrations(database, migrations, 1);
      unlinkSync(join(migrations, '0013_retention_indexes.sql'));
      expect(() => applyMigrations(database, migrations, 2)).toThrow(/file is missing/i);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
