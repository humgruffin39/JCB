import { appendFileSync, cpSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';

describe('database migrations', () => {
  it('expands supported bet types without changing existing pool rows or foreign keys', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jcb-bet-type-migration-'));
    const source = join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations');
    const migrations = join(directory, 'migrations');
    const migration = '0024_seven_bet_types.sql';
    cpSync(source, migrations, { recursive: true });
    unlinkSync(join(migrations, migration));
    const database = openDatabase(':memory:');
    try {
      applyMigrations(database, migrations, 1);
      database
        .prepare(
          `INSERT INTO races
           (id, race_date, name, kind, status, version, distance_m, going, surface,
            scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
            created_at, updated_at)
           VALUES ('race-1', '2026-08-20', '券種移行', 'regular', 'betting_open', 1, 1200,
                   'firm', 'turf', 100000, 80000, 90000, 70000, 1, 1)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO accounts
           (id, owner_type, owner_key, account_type, created_at)
           VALUES ('pool-account-1', 'race', 'race-1', 'race_win_pool', 1)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO account_balances (account_id, amount, updated_at)
           VALUES ('pool-account-1', 100, 1)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO ledger_transactions
           (id, kind, reference_type, reference_id, idempotency_key, description, created_at)
           VALUES ('ledger-1', 'migration_test', 'pool', 'pool-old', 'migration-ledger-1', '移行確認', 1)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO ledger_entries
           (id, transaction_id, account_id, amount, created_at)
           VALUES ('ledger-entry-1', 'ledger-1', 'pool-account-1', 100, 1)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO odds_probabilities
           (id, race_id, pool_type, selection_code, model_probability, base_odds, seed_stake, created_at)
           VALUES ('odds-old', 'race-1', 'win', '1', 1.0, 1.0, 100, 1)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO bet_pools
           (id, race_id, pool_type, account_id, seed_liquidity, user_stake_total, status)
           VALUES ('pool-old', 'race-1', 'win', 'pool-account-1', 100, 0, 'open')`,
        )
        .run();

      cpSync(join(source, migration), join(migrations, migration));
      applyMigrations(database, migrations, 2);

      expect(
        database
          .prepare(
            'SELECT pool_type AS poolType, selection_code AS selectionCode FROM odds_probabilities WHERE id = ?',
          )
          .get('odds-old'),
      ).toEqual({ poolType: 'win', selectionCode: '1' });
      expect(
        database
          .prepare('SELECT account_type AS accountType FROM accounts WHERE id = ?')
          .get('pool-account-1'),
      ).toEqual({ accountType: 'race_win_pool' });
      expect(
        database
          .prepare('SELECT account_id AS accountId FROM ledger_entries WHERE id = ?')
          .get('ledger-entry-1'),
      ).toEqual({ accountId: 'pool-account-1' });
      database
        .prepare(
          `INSERT INTO accounts
           (id, owner_type, owner_key, account_type, created_at)
           VALUES ('pool-account-2', 'race', 'race-1', 'race_place_pool', 2)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO odds_probabilities
           (id, race_id, pool_type, selection_code, model_probability, base_odds, seed_stake, created_at)
           VALUES ('odds-new', 'race-1', 'place', '1', 0.3, 3.3, 100, 2)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO bet_pools
           (id, race_id, pool_type, account_id, seed_liquidity, user_stake_total, status)
           VALUES ('pool-new', 'race-1', 'place', 'pool-account-2', 100, 0, 'open')`,
        )
        .run();
      expect(database.pragma('foreign_key_check')).toEqual([]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
