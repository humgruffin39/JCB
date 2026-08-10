import Database from 'better-sqlite3';
import { DEFAULT_GAME_SETTINGS } from '@jcb/config';
import { readBackupRetentionDays } from './litestream-config.js';

describe('Litestream retention settings', () => {
  it('uses the default before administrative settings exist', () => {
    const database = new Database(':memory:');
    try {
      expect(readBackupRetentionDays(database)).toBe(DEFAULT_GAME_SETTINGS.backupRetentionDays);
    } finally {
      database.close();
    }
  });

  it('loads the validated administrative value', () => {
    const database = new Database(':memory:');
    try {
      database.exec(`
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        )
      `);
      database.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)').run(
        'game_settings',
        JSON.stringify({
          ...DEFAULT_GAME_SETTINGS,
          backupRetentionDays: 45,
        }),
      );
      expect(readBackupRetentionDays(database)).toBe(45);
    } finally {
      database.close();
    }
  });

  it('uses the default for a settings record written by an older release', () => {
    const database = new Database(':memory:');
    try {
      database.exec(`
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        )
      `);
      database
        .prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)')
        .run('game_settings', JSON.stringify({ missingRaceWarningTime: '17:00:00' }));
      expect(readBackupRetentionDays(database)).toBe(DEFAULT_GAME_SETTINGS.backupRetentionDays);
    } finally {
      database.close();
    }
  });

  it('fails closed when persisted settings are malformed', () => {
    const database = new Database(':memory:');
    try {
      database.exec(`
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        )
      `);
      database
        .prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)')
        .run('game_settings', JSON.stringify({ backupRetentionDays: 0 }));
      expect(() => readBackupRetentionDays(database)).toThrow();
    } finally {
      database.close();
    }
  });
});
