import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrivateObjectStore } from '@jcb/application';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import {
  MAX_OBJECT_PUBLICATION_ATTEMPTS,
  publishPendingObjects,
  SqliteObjectPublicationStore,
} from './object-publication-store.js';

describe('SQLite object publication outbox', () => {
  it('retries a failed external write without losing the committed publication', async () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      1,
    );
    const publications = new SqliteObjectPublicationStore(database);
    publications.enqueue('manifest.json', new TextEncoder().encode('body'), { type: 'test' }, 100);
    let now = 100;
    let shouldFail = true;
    const objects = new Map<string, Uint8Array>();
    const objectStore: PrivateObjectStore = {
      async put(key, body) {
        if (shouldFail) throw new Error('temporary object-store outage');
        objects.set(key, body);
      },
      async get(key) {
        return objects.get(key);
      },
    };

    await expect(
      publishPendingObjects(publications, objectStore, 'publisher', () => now),
    ).resolves.toEqual({ completed: 0, failed: 1 });
    expect(
      (
        database
          .prepare('SELECT status, attempt_count AS attemptCount FROM object_publications')
          .get() as { status: string; attemptCount: bigint }
      ).status,
    ).toBe('pending');

    shouldFail = false;
    now = 1_100;
    await expect(
      publishPendingObjects(publications, objectStore, 'publisher', () => now),
    ).resolves.toEqual({ completed: 1, failed: 0 });
    expect(new TextDecoder().decode(objects.get('manifest.json'))).toBe('body');
    database.close();
  });

  it('rejects conflicting content for the same object key', () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      1,
    );
    const publications = new SqliteObjectPublicationStore(database);
    publications.enqueue('same-key', new Uint8Array([1]), {}, 1);
    expect(() => publications.enqueue('same-key', new Uint8Array([2]), {}, 1)).toThrow(
      /different content/i,
    );
    database.close();
  });

  it('queues a newer version after the previous object version was published', () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      1,
    );
    const publications = new SqliteObjectPublicationStore(database);
    publications.enqueue('mutable-manifest', new Uint8Array([1]), {}, 1);
    const first = publications.claimDue(1, 'publisher');
    expect(first).toBeDefined();
    publications.complete(first!.id, 'publisher', 1);
    publications.enqueue('mutable-manifest', new Uint8Array([2]), {}, 2);
    expect(Array.from(publications.claimDue(2, 'publisher')!.body)).toEqual([2]);
    database.close();
  });

  it('moves permanently failing publications to dead-letter and allows an explicit retry', async () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      1,
    );
    const publications = new SqliteObjectPublicationStore(database);
    publications.enqueue('dead-letter.json', new Uint8Array([1]), {}, 1);
    const objectStore: PrivateObjectStore = {
      async put() {
        throw new Error('permanent object-store outage');
      },
      async get() {
        return undefined;
      },
    };

    for (let attempt = 0; attempt < MAX_OBJECT_PUBLICATION_ATTEMPTS; attempt += 1) {
      const now = 100_000 + attempt * 60_000;
      await publishPendingObjects(publications, objectStore, 'publisher', () => now);
    }
    expect(
      database
        .prepare('SELECT status, attempt_count AS attemptCount FROM object_publications')
        .get() as { status: string; attemptCount: bigint },
    ).toEqual({ status: 'dead_letter', attemptCount: BigInt(MAX_OBJECT_PUBLICATION_ATTEMPTS) });
    expect(publications.claimDue(1_000_000, 'publisher')).toBeUndefined();

    const id = (database.prepare('SELECT id FROM object_publications').get() as { id: string }).id;
    publications.retryDeadLetter(id, 2_000_000);
    expect(publications.claimDue(2_000_000, 'publisher')?.attemptCount).toBe(1);
    database.close();
  });
});
