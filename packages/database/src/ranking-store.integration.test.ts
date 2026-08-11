import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './connection.js';
import { SqliteGameStore } from './game-store.js';
import { applyMigrations } from './migrations.js';
import { SqliteRankingStore } from './ranking-store.js';

describe('ranking calculation', () => {
  it('uses a constant number of prepared queries as the user count grows', () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      1,
    );
    const game = new SqliteGameStore(database, () => 1);
    game.initializeEconomy([]);
    for (let index = 0; index < 50; index += 1) {
      game.registerUser(`user-${String(index)}`, `利用者${String(index)}`, true);
    }
    const prepare = vi.spyOn(database, 'prepare');
    const snapshot = new SqliteRankingStore(database, () => 2).calculateAndSave();
    expect(snapshot.users).toHaveLength(50);
    expect(prepare).toHaveBeenCalledTimes(6);
    database.close();
  });
});
