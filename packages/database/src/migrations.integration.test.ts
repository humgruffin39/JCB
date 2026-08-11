import { appendFileSync, cpSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';

describe('database migrations', () => {
  it('detects modification of an already-applied migration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jcb-migrations-'));
    const source = join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations');
    const migrations = join(directory, 'migrations');
    cpSync(source, migrations, { recursive: true });
    const database = openDatabase(':memory:');
    try {
      applyMigrations(database, migrations, 1);
      appendFileSync(join(migrations, '0012_object_publication_outbox.sql'), '\n-- modified\n');
      expect(() => applyMigrations(database, migrations, 2)).toThrow(/checksum mismatch/i);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('detects removal of an already-applied migration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jcb-migrations-'));
    const source = join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations');
    const migrations = join(directory, 'migrations');
    cpSync(source, migrations, { recursive: true });
    const database = openDatabase(':memory:');
    try {
      applyMigrations(database, migrations, 1);
      unlinkSync(join(migrations, '0013_retention_indexes.sql'));
      expect(() => applyMigrations(database, migrations, 2)).toThrow(/file is missing/i);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
