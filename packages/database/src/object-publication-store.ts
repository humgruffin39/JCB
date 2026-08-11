import type Database from 'better-sqlite3';
import type { PrivateObjectStore } from '@jcb/application';
import { ulid } from 'ulid';

export const MAX_OBJECT_PUBLICATION_ATTEMPTS = 8;

export interface ObjectPublication {
  readonly id: string;
  readonly key: string;
  readonly body: Uint8Array;
  readonly metadata: Readonly<Record<string, string>>;
  readonly attemptCount: number;
}

interface PublicationRow {
  readonly id: string;
  readonly key: string;
  readonly body: Uint8Array;
  readonly metadataJson: string;
  readonly attemptCount: bigint;
}

export class SqliteObjectPublicationStore {
  public constructor(private readonly database: Database.Database) {}

  public enqueue(
    key: string,
    body: Uint8Array,
    metadata: Readonly<Record<string, string>>,
    now: number,
  ): void {
    const serializedMetadata = JSON.stringify(metadata);
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO object_publications
         (id, object_key, body, metadata_json, status, attempt_count, next_attempt_at,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
      )
      .run(
        ulid(),
        key,
        Buffer.from(body),
        serializedMetadata,
        BigInt(now),
        BigInt(now),
        BigInt(now),
      );
    if (result.changes === 0) {
      const existing = this.database
        .prepare(
          `SELECT body, metadata_json AS metadataJson, status
           FROM object_publications WHERE object_key = ?`,
        )
        .get(key) as
        | { body: Uint8Array; metadataJson: string; status: 'pending' | 'running' | 'completed' }
        | undefined;
      const matches =
        existing !== undefined &&
        Buffer.from(existing.body).equals(Buffer.from(body)) &&
        existing.metadataJson === serializedMetadata;
      if (matches) return;
      if (existing?.status === 'completed') {
        const update = this.database
          .prepare(
            `UPDATE object_publications
             SET body = ?, metadata_json = ?, status = 'pending', attempt_count = 0,
                 next_attempt_at = ?, locked_at = NULL, locked_by = NULL,
                 last_error_redacted = NULL, updated_at = ?
             WHERE object_key = ? AND status = 'completed'`,
          )
          .run(Buffer.from(body), serializedMetadata, BigInt(now), BigInt(now), key);
        if (update.changes === 1) return;
      }
      if (
        existing === undefined ||
        !Buffer.from(existing.body).equals(Buffer.from(body)) ||
        existing.metadataJson !== serializedMetadata
      ) {
        throw new Error('Object publication key was reused with different content.');
      }
    }
  }

  public claimDue(now: number, workerId: string): ObjectPublication | undefined {
    const run = this.database.transaction(() => {
      const row = this.database
        .prepare(
          `SELECT id, object_key AS key, body, metadata_json AS metadataJson,
                  attempt_count AS attemptCount
           FROM object_publications
           WHERE status = 'pending' AND next_attempt_at <= ?
           ORDER BY next_attempt_at, id LIMIT 1`,
        )
        .get(BigInt(now)) as PublicationRow | undefined;
      if (row === undefined) return undefined;
      const update = this.database
        .prepare(
          `UPDATE object_publications
           SET status = 'running', attempt_count = attempt_count + 1,
               locked_at = ?, locked_by = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(BigInt(now), workerId, BigInt(now), row.id);
      if (update.changes !== 1) return undefined;
      return mapPublication({ ...row, attemptCount: row.attemptCount + 1n });
    });
    return run.immediate();
  }

  public complete(id: string, workerId: string, now: number): void {
    const result = this.database
      .prepare(
        `UPDATE object_publications
         SET status = 'completed', locked_at = NULL, locked_by = NULL,
             last_error_redacted = NULL, updated_at = ?
         WHERE id = ? AND status = 'running' AND locked_by = ?`,
      )
      .run(BigInt(now), id, workerId);
    if (result.changes !== 1) throw new Error('Object publication completion lost its lock.');
  }

  public fail(publication: ObjectPublication, workerId: string, now: number, error: unknown): void {
    const isDeadLetter = publication.attemptCount >= MAX_OBJECT_PUBLICATION_ATTEMPTS;
    const backoff = Math.min(60_000, 1_000 * 2 ** Math.min(publication.attemptCount - 1, 6));
    const message = error instanceof Error ? error.message : 'Unknown object publication error.';
    const result = this.database
      .prepare(
        `UPDATE object_publications
         SET status = ?, next_attempt_at = ?, locked_at = NULL, locked_by = NULL,
             last_error_redacted = ?, updated_at = ?
         WHERE id = ? AND status = 'running' AND locked_by = ?`,
      )
      .run(
        isDeadLetter ? 'dead_letter' : 'pending',
        BigInt(isDeadLetter ? now : now + backoff),
        message.slice(0, 300),
        BigInt(now),
        publication.id,
        workerId,
      );
    if (result.changes !== 1) throw new Error('Object publication failure lost its lock.');
  }

  public retryDeadLetter(id: string, now: number): void {
    const result = this.database
      .prepare(
        `UPDATE object_publications
         SET status = 'pending', attempt_count = 0, next_attempt_at = ?,
             locked_at = NULL, locked_by = NULL, last_error_redacted = NULL, updated_at = ?
         WHERE id = ? AND status = 'dead_letter'`,
      )
      .run(BigInt(now), BigInt(now), id);
    if (result.changes !== 1) throw new Error('Object publication dead-letter was not found.');
  }

  public reclaimStale(now: number, staleAfterMilliseconds: number): number {
    return this.database
      .prepare(
        `UPDATE object_publications
         SET status = 'pending', next_attempt_at = ?, locked_at = NULL, locked_by = NULL,
             last_error_redacted = 'Publisher lock expired after restart.', updated_at = ?
         WHERE status = 'running' AND locked_at < ?`,
      )
      .run(BigInt(now), BigInt(now), BigInt(now - staleAfterMilliseconds)).changes;
  }
}

export async function publishPendingObjects(
  publications: SqliteObjectPublicationStore,
  objectStore: PrivateObjectStore,
  workerId: string,
  now: () => number,
  limit = 20,
): Promise<{ readonly completed: number; readonly failed: number }> {
  let completed = 0;
  let failed = 0;
  for (let index = 0; index < limit; index += 1) {
    const publication = publications.claimDue(now(), workerId);
    if (publication === undefined) break;
    try {
      await objectStore.put(publication.key, publication.body, publication.metadata);
      publications.complete(publication.id, workerId, now());
      completed += 1;
    } catch (error) {
      publications.fail(publication, workerId, now(), error);
      failed += 1;
    }
  }
  return { completed, failed };
}

function mapPublication(row: PublicationRow): ObjectPublication {
  const parsed: unknown = JSON.parse(row.metadataJson);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Object publication metadata is invalid.');
  }
  const metadata = Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => {
      if (typeof value !== 'string') throw new Error('Object publication metadata is invalid.');
      return [key, value];
    }),
  );
  return {
    id: row.id,
    key: row.key,
    body: new Uint8Array(row.body),
    metadata,
    attemptCount: Number(row.attemptCount),
  };
}
