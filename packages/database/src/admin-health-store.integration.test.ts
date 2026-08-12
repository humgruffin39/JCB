import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteAdminHealthStore } from './admin-health-store.js';
import { openDatabase } from './connection.js';
import { SqliteGameStore } from './game-store.js';
import { applyMigrations } from './migrations.js';

describe('admin health probes', () => {
  it('keeps GET health read-only and rejects future freshness timestamps', () => {
    const now = 1_800_000_000_000;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    try {
      new SqliteGameStore(database, () => now).initializeEconomy([]);
      const healthStore = new SqliteAdminHealthStore(database, () => now);

      expect(healthStore.health().databaseReadWrite).toBe(false);
      expect(database.prepare("SELECT 1 FROM health_probes WHERE id = 'database'").get()).toBe(
        undefined,
      );

      expect(healthStore.probeDatabaseReadWrite()).toBe(true);
      expect(healthStore.health().databaseReadWrite).toBe(true);
      database
        .prepare(
          "INSERT INTO app_settings (key, value_json, updated_at) VALUES ('scheduler_heartbeat_at', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        )
        .run(JSON.stringify(new Date(now + 60_000).toISOString()), BigInt(now));
      expect(healthStore.health().schedulerStatus).toBe('failure');
    } finally {
      database.close();
    }
  });
});
