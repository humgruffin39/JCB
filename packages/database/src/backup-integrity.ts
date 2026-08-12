import type Database from 'better-sqlite3';
import type { PrivateObjectStore } from '@jcb/application';
import { createHash } from 'node:crypto';
import { SqliteLedgerStore } from './ledger-store.js';

export function assertDatabaseIntegrity(database: Database.Database): void {
  const integrity = database.pragma('integrity_check') as { integrity_check: string }[];
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
    throw new Error('SQLite integrity_check failed.');
  }
  const foreignKeyViolations = database.pragma('foreign_key_check') as unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new Error('SQLite foreign_key_check found violations.');
  }
  new SqliteLedgerStore(database, Date.now).assertProjectionIntegrity();
}

export interface DatabaseRecordCounts {
  readonly races: number;
  readonly bets: number;
  readonly accounts: number;
}

export function databaseRecordCounts(database: Database.Database): DatabaseRecordCounts {
  const row = database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM races) AS races,
         (SELECT COUNT(*) FROM bets) AS bets,
         (SELECT COUNT(*) FROM accounts) AS accounts`,
    )
    .get() as { races: bigint; bets: bigint; accounts: bigint };
  return {
    races: Number(row.races),
    bets: Number(row.bets),
    accounts: Number(row.accounts),
  };
}

export function assertRecordCountsMatch(
  primary: DatabaseRecordCounts,
  restored: DatabaseRecordCounts,
): void {
  for (const key of ['races', 'bets', 'accounts'] as const) {
    if (primary[key] !== restored[key]) {
      throw new Error(
        `Restore drill ${key} count mismatch: primary=${String(primary[key])}, restored=${String(restored[key])}.`,
      );
    }
  }
}

export async function assertPublishedRaceObjects(
  database: Database.Database,
  objectStore: Pick<PrivateObjectStore, 'get'>,
): Promise<number> {
  const rows = database
    .prepare(
      `SELECT rs.race_id AS raceId, rs.race_version AS raceVersion,
              rs.timeline_object_key AS timelineObjectKey,
              rs.timeline_sha256 AS timelineSha256
       FROM race_simulations rs
       JOIN races r ON r.id = rs.race_id
       WHERE rs.kind = 'official'
         AND rs.race_version = r.version
         AND rs.status = 'completed'
         AND rs.timeline_object_key IS NOT NULL
         AND rs.timeline_sha256 IS NOT NULL
         AND r.status IN ('betting_open', 'betting_closed', 'ready', 'running',
                          'finished', 'settling', 'settled')
       ORDER BY rs.race_id, rs.race_version`,
    )
    .all() as Array<{
    raceId: string;
    raceVersion: bigint;
    timelineObjectKey: string;
    timelineSha256: string;
  }>;

  for (const row of rows) {
    const timeline = await objectStore.get(row.timelineObjectKey);
    if (timeline === undefined) {
      throw new Error(`Restore drill timeline object is missing: ${row.timelineObjectKey}.`);
    }
    const timelineSha256 = createHash('sha256').update(timeline).digest('hex');
    if (timelineSha256 !== row.timelineSha256) {
      throw new Error(`Restore drill timeline hash mismatch: ${row.timelineObjectKey}.`);
    }

    const manifestKey = `race-manifests/${row.raceId}.json`;
    const manifestBytes = await objectStore.get(manifestKey);
    if (manifestBytes === undefined) {
      throw new Error(`Restore drill release manifest is missing: ${manifestKey}.`);
    }
    const manifest = parsePublishedManifest(manifestBytes, manifestKey);
    if (
      manifest.raceId !== row.raceId ||
      manifest.raceVersion !== Number(row.raceVersion) ||
      manifest.ciphertextObjectKey !== row.timelineObjectKey ||
      manifest.ciphertextSha256 !== row.timelineSha256
    ) {
      throw new Error(`Restore drill release manifest does not match ${row.raceId}.`);
    }
  }

  return rows.length;
}

interface PublishedManifest {
  readonly raceId: string;
  readonly raceVersion: number;
  readonly ciphertextObjectKey: string;
  readonly ciphertextSha256: string;
}

function parsePublishedManifest(bytes: Uint8Array, key: string): PublishedManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new Error(`Restore drill release manifest is not valid JSON: ${key}.`);
  }
  if (!isRecord(parsed) || !isRecord(parsed.manifest) || typeof parsed.signature !== 'string') {
    throw new Error(`Restore drill release manifest is malformed: ${key}.`);
  }
  const manifest = parsed.manifest;
  if (
    typeof manifest.raceId !== 'string' ||
    typeof manifest.raceVersion !== 'number' ||
    !Number.isSafeInteger(manifest.raceVersion) ||
    typeof manifest.ciphertextObjectKey !== 'string' ||
    typeof manifest.ciphertextSha256 !== 'string'
  ) {
    throw new Error(`Restore drill release manifest is malformed: ${key}.`);
  }
  return {
    raceId: manifest.raceId,
    raceVersion: manifest.raceVersion,
    ciphertextObjectKey: manifest.ciphertextObjectKey,
    ciphertextSha256: manifest.ciphertextSha256,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
