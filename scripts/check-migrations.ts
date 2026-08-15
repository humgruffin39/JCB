import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, openDatabase } from '@jcb/database';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'jcb-migration-'));
const databasePath = join(temporaryDirectory, 'migration-check.sqlite');
const database = openDatabase(databasePath);

try {
  applyMigrations(
    database,
    join(repositoryRoot, 'packages', 'database', 'migrations'),
    Date.parse('2026-08-03T00:00:00Z'),
  );
  const tables = new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name),
  );
  for (const table of [
    'accounts',
    'ledger_transactions',
    'ledger_entries',
    'account_balances',
    'horses',
    'races',
    'race_entries',
    'race_entry_drafts',
    'race_simulations',
    'bets',
    'scheduled_jobs',
    'audit_logs',
    'oauth_login_states',
    'health_probes',
    'object_publications',
    'counting_state',
    'activity_launch_intents',
    'activity_instances',
    'activity_sessions',
  ]) {
    if (!tables.has(table)) throw new Error(`Migration did not create ${table}.`);
  }
  const integrity = database.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${String(integrity)}`);
  const foreignKeyViolations = database.pragma('foreign_key_check') as unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new Error(
      `SQLite foreign key check found ${String(foreignKeyViolations.length)} errors.`,
    );
  }
  process.stdout.write(`Applied migrations to scratch database: ${databasePath}\n`);
} finally {
  database.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
