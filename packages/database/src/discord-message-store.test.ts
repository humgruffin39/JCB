import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations } from './migrations.js';
import { openDatabase } from './connection.js';
import { SqliteDiscordMessageStore } from './discord-message-store.js';

const migrationsDirectory = join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations');

describe('Discord message store', () => {
  it('removes a persisted race message reference idempotently', () => {
    const database = openDatabase(':memory:');
    applyMigrations(database, migrationsDirectory, 1);
    database
      .prepare(
        `INSERT INTO races
         (id, race_date, name, kind, status, version, distance_m, going, surface,
          scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
          created_at, updated_at)
         VALUES ('race-1', '2026-08-20', '通知削除試験', 'regular', 'settled', 1, 1200,
                 'firm', 'turf', 400, 100, 200, 300, 1, 1)`,
      )
      .run();
    const store = new SqliteDiscordMessageStore(database, () => 2);
    store.save({
      purpose: 'race_reminder',
      raceId: 'race-1',
      channelId: 'channel-1',
      messageId: 'message-1',
    });

    store.remove('race_reminder', 'race-1');
    store.remove('race_reminder', 'race-1');

    expect(store.get('race_reminder', 'race-1')).toBeUndefined();
    database.close();
  });
});
