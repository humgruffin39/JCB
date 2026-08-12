import type { PrivateObjectStore } from '@jcb/application';
import { SqliteObjectPublicationStore, type SqliteDatabase } from '@jcb/database';
import type { MissingPublishedObjectRepairResult } from './scheduler-types.js';

export const ORPHAN_TIMELINE_GRACE_MILLISECONDS = 2 * 60 * 60 * 1_000;

export async function cleanupOrphanedTimelineObjects(
  database: SqliteDatabase,
  objectStore: PrivateObjectStore,
  now: number,
  graceMilliseconds = ORPHAN_TIMELINE_GRACE_MILLISECONDS,
): Promise<number> {
  const referenced = new Set<string>(
    (
      database
        .prepare(
          `SELECT timeline_object_key AS objectKey
           FROM race_simulations
           WHERE timeline_object_key IS NOT NULL
           UNION
           SELECT object_key AS objectKey
           FROM object_publications
           WHERE object_key LIKE 'timelines/%' AND status <> 'cancelled'`,
        )
        .all() as Array<{ objectKey: string }>
    ).map((row) => row.objectKey),
  );
  const objects = await objectStore.list('timelines/');
  let deleted = 0;
  for (const object of objects) {
    if (
      referenced.has(object.key) ||
      object.lastModifiedAt === undefined ||
      now - object.lastModifiedAt < graceMilliseconds
    ) {
      continue;
    }
    await objectStore.delete(object.key);
    deleted += 1;
  }
  return deleted;
}

export async function repairMissingPublishedObjects(
  database: SqliteDatabase,
  objectStore: PrivateObjectStore,
  now: number,
): Promise<MissingPublishedObjectRepairResult> {
  const rows = database
    .prepare(
      `SELECT r.id AS raceId, rs.timeline_object_key AS timelineObjectKey
       FROM race_simulations rs
       JOIN races r ON r.id = rs.race_id
       WHERE rs.kind = 'official'
         AND rs.race_version = r.version
         AND rs.status = 'completed'
         AND rs.timeline_object_key IS NOT NULL
         AND rs.timeline_sha256 IS NOT NULL
         AND r.status NOT IN ('cancelled', 'failed')`,
    )
    .all() as Array<{ raceId: string; timelineObjectKey: string }>;
  const expectedKeys = new Set<string>();
  for (const row of rows) {
    expectedKeys.add(row.timelineObjectKey);
    expectedKeys.add(`race-manifests/${row.raceId}.json`);
  }
  if (expectedKeys.size === 0) return { requeued: [], unrecoverable: [] };

  const objects = await Promise.all([
    objectStore.list('timelines/'),
    objectStore.list('race-manifests/'),
  ]);
  const presentKeys = new Set(objects.flat().map((object) => object.key));
  const publications = new SqliteObjectPublicationStore(database);
  const requeued: string[] = [];
  const unrecoverable: string[] = [];
  for (const key of expectedKeys) {
    if (presentKeys.has(key)) continue;
    const status = publications.requeueForRepair(key, now);
    if (status === 'requeued') requeued.push(key);
    else if (status === 'missing') unrecoverable.push(key);
  }
  return { requeued, unrecoverable };
}
