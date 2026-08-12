import {
  assertDatabaseIntegrity,
  assertPublishedRaceObjects,
  assertRecordCountsMatch,
  databaseRecordCounts,
  openDatabase,
  SqliteAdminStore,
  type DatabaseRecordCounts,
} from '@jcb/database';
import { R2PrivateObjectStore } from './object-store.js';
import { resolve } from 'node:path';

const restoredPath = process.argv[2];
const primaryPath = process.env.DATABASE_PATH;
if (restoredPath === undefined || primaryPath === undefined) {
  throw new Error('Usage: record-restore-drill RESTORED_PATH with DATABASE_PATH configured.');
}
if (resolve(restoredPath) === resolve(primaryPath)) {
  throw new Error('Restore drill database must not be the production database.');
}

const restored = openDatabase(restoredPath);
const timelineStore = new R2PrivateObjectStore(
  requiredEnvironment('R2_ACCOUNT_ID'),
  requiredEnvironment('R2_ACCESS_KEY_ID'),
  requiredEnvironment('R2_SECRET_ACCESS_KEY'),
  requiredEnvironment('R2_TIMELINE_BUCKET'),
);
const restoredCounts: DatabaseRecordCounts = await (async () => {
  try {
    assertDatabaseIntegrity(restored);
    const publishedObjectCount = await assertPublishedRaceObjects(restored, timelineStore);
    process.stdout.write(
      `Verified ${String(publishedObjectCount)} published race object set(s) in R2.\n`,
    );
    return databaseRecordCounts(restored);
  } finally {
    restored.close();
  }
})();

const recordedAt = new Date().toISOString();
const primary = openDatabase(primaryPath);
try {
  const primaryCounts = databaseRecordCounts(primary);
  assertRecordCountsMatch(primaryCounts, restoredCounts);
  const admin = new SqliteAdminStore(primary, Date.now);
  admin.recordSystemSetting('last_restore_drill_at', recordedAt);
  admin.recordAudit({
    action: 'backup.restore_drill_succeeded',
    targetType: 'backup',
    targetId: 'litestream',
    reason: 'Automated monthly restore drill passed full integrity validation.',
    after: { recordedAt, primaryCounts, restoredCounts },
  });
} finally {
  primary.close();
}

process.stdout.write(`Restore drill passed and was recorded at ${recordedAt}.\n`);

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}
