import type Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export interface AppliedMigration {
  readonly version: string;
  readonly appliedAt: bigint;
  readonly checksum: string;
}

export function applyMigrations(
  database: Database.Database,
  migrationsDirectory: string,
  now: number,
): readonly AppliedMigration[] {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      checksum TEXT
    )
  `);
  const columns = database.prepare('PRAGMA table_info(schema_migrations)').all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === 'checksum')) {
    database.exec('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT');
  }
  const applied = new Map(
    (
      database.prepare('SELECT version, checksum FROM schema_migrations').all() as Array<{
        version: string;
        checksum: string | null;
      }>
    ).map((row) => [row.version, row.checksum]),
  );
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  const migrationFileSet = new Set(migrationFiles);
  for (const version of applied.keys()) {
    if (!migrationFileSet.has(version)) {
      throw new Error(`Applied migration file is missing: ${version}`);
    }
  }
  const foreignKeys = Number(database.pragma('foreign_keys', { simple: true }));
  // Some SQLite schema migrations must rebuild a parent table. SQLite does not
  // allow foreign_keys to be toggled from inside a transaction, so temporarily
  // disable enforcement around the atomic migration batch and restore it even
  // when a migration fails.
  database.pragma('foreign_keys = OFF');
  try {
    const run = database.transaction(() => {
      for (const fileName of migrationFiles) {
        const sql = readFileSync(join(migrationsDirectory, fileName), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const existingChecksum = applied.get(fileName);
        if (existingChecksum !== undefined) {
          if (existingChecksum === null) {
            database
              .prepare('UPDATE schema_migrations SET checksum = ? WHERE version = ?')
              .run(checksum, fileName);
          } else if (existingChecksum !== checksum) {
            throw new Error(`Applied migration checksum mismatch: ${fileName}`);
          }
          continue;
        }
        database.exec(sql);
        database
          .prepare('INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?)')
          .run(fileName, BigInt(now), checksum);
      }
    });
    run.immediate();
  } finally {
    database.pragma(`foreign_keys = ${foreignKeys === 0 ? 'OFF' : 'ON'}`);
  }
  return database
    .prepare(
      'SELECT version, applied_at AS appliedAt, checksum FROM schema_migrations ORDER BY version',
    )
    .all() as AppliedMigration[];
}
