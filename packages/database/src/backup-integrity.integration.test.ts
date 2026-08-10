import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertDatabaseIntegrity,
  assertRecordCountsMatch,
  databaseRecordCounts,
} from './backup-integrity.js';
import { openDatabase } from './connection.js';
import { SqliteGameStore } from './game-store.js';
import { applyMigrations } from './migrations.js';

describe('SQLite backup restore drill', () => {
  it('opens a physical backup and verifies SQLite, foreign keys, and ledger projections', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jcb-restore-drill-'));
    const sourcePath = join(directory, 'source.sqlite');
    const restoredPath = join(directory, 'restored.sqlite');
    const source = openDatabase(sourcePath);
    applyMigrations(
      source,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      1_000,
    );
    new SqliteGameStore(source, () => 1_000).initializeEconomy([]);
    await source.backup(restoredPath);
    source.close();

    const restored = openDatabase(restoredPath);
    expect(() => assertDatabaseIntegrity(restored)).not.toThrow();
    const counts = databaseRecordCounts(restored);
    expect(counts.accounts).toBe(3);
    expect(() => assertRecordCountsMatch(counts, counts)).not.toThrow();
    expect(() => assertRecordCountsMatch(counts, { ...counts, races: counts.races + 1 })).toThrow(
      /count mismatch/,
    );
    restored.close();
    await rm(directory, { recursive: true });
  });
});
