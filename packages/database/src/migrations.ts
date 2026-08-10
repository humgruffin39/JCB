import type Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface AppliedMigration {
  readonly version: string;
  readonly appliedAt: bigint;
}

export function applyMigrations(
  database: Database.Database,
  migrationsDirectory: string,
  now: number,
): readonly AppliedMigration[] {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  const applied = new Set(
    database
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: string }).version),
  );
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  const run = database.transaction(() => {
    for (const fileName of migrationFiles) {
      if (applied.has(fileName)) continue;
      database.exec(readFileSync(join(migrationsDirectory, fileName), 'utf8'));
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(fileName, BigInt(now));
    }
  });
  run.immediate();
  return database
    .prepare('SELECT version, applied_at AS appliedAt FROM schema_migrations ORDER BY version')
    .all() as AppliedMigration[];
}
