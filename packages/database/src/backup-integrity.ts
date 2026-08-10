import type Database from 'better-sqlite3';
import { SqliteLedgerStore } from './ledger-store.js';

export function assertDatabaseIntegrity(database: Database.Database): void {
  const integrity = database.pragma('integrity_check') as { integrity_check: string }[];
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
    throw new Error('SQLite integrity_check failed.');
  }
  const foreignKeyViolations = database.pragma('foreign_key_check') as unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new Error('SQLite foreign_key_check found violations.');
  }
  new SqliteLedgerStore(database, Date.now).assertProjectionIntegrity();
}

export interface DatabaseRecordCounts {
  readonly races: number;
  readonly bets: number;
  readonly accounts: number;
}

export function databaseRecordCounts(database: Database.Database): DatabaseRecordCounts {
  const row = database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM races) AS races,
         (SELECT COUNT(*) FROM bets) AS bets,
         (SELECT COUNT(*) FROM accounts) AS accounts`,
    )
    .get() as { races: bigint; bets: bigint; accounts: bigint };
  return {
    races: Number(row.races),
    bets: Number(row.bets),
    accounts: Number(row.accounts),
  };
}

export function assertRecordCountsMatch(
  primary: DatabaseRecordCounts,
  restored: DatabaseRecordCounts,
): void {
  for (const key of ['races', 'bets', 'accounts'] as const) {
    if (primary[key] !== restored[key]) {
      throw new Error(
        `Restore drill ${key} count mismatch: primary=${String(primary[key])}, restored=${String(restored[key])}.`,
      );
    }
  }
}
