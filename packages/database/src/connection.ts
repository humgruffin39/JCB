import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface OpenDatabaseOptions {
  readonly readonly?: boolean;
  readonly fileMustExist?: boolean;
}

export type SqliteDatabase = Database.Database;

export function openDatabase(
  databasePath: string,
  options: OpenDatabaseOptions = {},
): SqliteDatabase {
  if (databasePath !== ':memory:' && !options.readonly) {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const database = new Database(databasePath, {
    readonly: options.readonly ?? false,
    fileMustExist: options.fileMustExist ?? false,
  });
  database.defaultSafeIntegers(true);
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  if (!options.readonly) {
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
  }
  return database;
}
