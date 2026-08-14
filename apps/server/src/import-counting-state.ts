import { applyMigrations, openDatabase } from '@jcb/database';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StateStore } from './counting-bot/persistence/stateStore.js';
import { Logger } from './counting-bot/logging/logger.js';

const databasePath = process.env.DATABASE_PATH?.trim() ?? '/data/jcb.sqlite';
const importPath = process.env.COUNTING_STATE_IMPORT_PATH?.trim();
if (importPath === undefined || importPath.length === 0) {
  throw new Error('COUNTING_STATE_IMPORT_PATH is required.');
}

const repositoryRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const database = openDatabase(databasePath);
try {
  applyMigrations(database, join(repositoryRoot, 'packages', 'database', 'migrations'), Date.now());
  const imported = await new StateStore(database, new Logger('info')).importJsonIfEmpty(importPath);
  process.stdout.write(
    imported ? 'Counting state imported.\n' : 'Counting state already exists.\n',
  );
} finally {
  database.close();
}
