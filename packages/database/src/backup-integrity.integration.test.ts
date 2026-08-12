import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertDatabaseIntegrity,
  assertPublishedRaceObjects,
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

  it('verifies published timeline and manifest objects against the restored database', async () => {
    const now = 1_000;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    const timeline = new Uint8Array([1, 2, 3]);
    const timelineKey = 'timelines/race-1/verified.bin';
    const timelineSha256 = createHash('sha256').update(timeline).digest('hex');
    database
      .prepare(
        `INSERT INTO races
         (id, race_date, name, kind, status, version, distance_m, going,
          scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
          created_at, updated_at)
         VALUES ('race-1', '2026-08-12', '復旧確認', 'regular', 'settled', 1, 1200, 'firm',
                 100000, 80000, 90000, 70000, 1000, 1000)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO race_simulations
         (id, race_id, race_version, kind, status, seed_ciphertext, prng_version,
          simulation_version, input_hash, timeline_object_key, timeline_sha256,
          started_at, completed_at)
         VALUES ('simulation-1', 'race-1', 1, 'official', 'completed', '{}', 'prng-v1',
                 'simulation-v1', 'input-hash', ?, ?, 1000, 1000)`,
      )
      .run(timelineKey, timelineSha256);
    const objects = new Map<string, Uint8Array>([
      [timelineKey, timeline],
      [
        'race-manifests/race-1.json',
        new TextEncoder().encode(
          JSON.stringify({
            manifest: {
              raceId: 'race-1',
              raceVersion: 1,
              ciphertextObjectKey: timelineKey,
              ciphertextSha256: timelineSha256,
            },
            signature: 'signature-with-enough-length',
          }),
        ),
      ],
    ]);
    const objectStore = { get: async (key: string) => objects.get(key) };

    await expect(assertPublishedRaceObjects(database, objectStore)).resolves.toBe(1);
    objects.set(timelineKey, new Uint8Array([9]));
    await expect(assertPublishedRaceObjects(database, objectStore)).rejects.toThrow(
      /hash mismatch/,
    );
    database.close();
  });
});
