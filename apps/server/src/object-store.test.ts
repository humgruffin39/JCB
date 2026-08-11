import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilePrivateObjectStore } from './object-store.js';

describe('file private object store', () => {
  it('round-trips portable object keys and rejects traversal with either separator', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jcb-objects-'));
    try {
      const store = new FilePrivateObjectStore(directory);
      await store.put('timelines/race/object.bin', new Uint8Array([1, 2, 3]), {});
      const stored = await store.get('timelines/race/object.bin');
      expect(stored === undefined ? undefined : Array.from(stored)).toEqual([1, 2, 3]);
      await expect(store.put('../escape.bin', new Uint8Array(), {})).rejects.toThrow(/escapes/i);
      await expect(store.put('..\\escape.bin', new Uint8Array(), {})).rejects.toThrow(/escapes/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
