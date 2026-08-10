import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { DEFAULT_GAME_SETTINGS, parseBackupRetentionDays } from '@jcb/config';

export function readBackupRetentionDays(database: Database.Database): number {
  const settingsTable = database
    .prepare(
      `SELECT 1 AS present
         FROM sqlite_master
        WHERE type = 'table' AND name = 'app_settings'`,
    )
    .get() as { present: 1 } | undefined;
  if (settingsTable === undefined) {
    return DEFAULT_GAME_SETTINGS.backupRetentionDays;
  }
  const row = database
    .prepare("SELECT value_json AS valueJson FROM app_settings WHERE key = 'game_settings'")
    .get() as { valueJson: string } | undefined;
  if (row === undefined) {
    return DEFAULT_GAME_SETTINGS.backupRetentionDays;
  }
  return parseBackupRetentionDays(JSON.parse(row.valueJson));
}

export function readBackupRetentionDaysFromPath(databasePath: string): number {
  if (!existsSync(databasePath)) {
    return DEFAULT_GAME_SETTINGS.backupRetentionDays;
  }
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    return readBackupRetentionDays(database);
  } finally {
    database.close();
  }
}
