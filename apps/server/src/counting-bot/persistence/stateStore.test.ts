import { applyMigrations, openDatabase } from '@jcb/database';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Logger } from '../logging/logger.js';
import { createInitialState, serializeState } from './stateSchema.js';
import { StateStore } from './stateStore.js';

const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

function createStore() {
  const database = openDatabase(':memory:');
  applyMigrations(database, join(repositoryRoot, 'packages', 'database', 'migrations'), Date.now());
  return { database, store: new StateStore(database, new Logger('error')) };
}

describe('SQLite counting state store', () => {
  it('round-trips the complete counting aggregate', async () => {
    const { database, store } = createStore();
    const state = createInitialState({
      guildId: '100000000000000001',
      channelId: '100000000000000002',
      initialCount: '3',
      latestMessageId: '100000000000000003',
    });
    const enriched = {
      ...state,
      bestCount: '4',
      failureCounts: { '100000000000000004': '2' },
      successfulCounts: { '100000000000000005': '4' },
      appliedHistoryImports: ['legacy-import'],
      pendingFailures: [
        {
          failedMessageId: '100000000000000006',
          failedUserId: '100000000000000007',
          timeoutUntil: '2026-08-14T00:00:00.000Z',
          roleStatus: 'pending' as const,
          timeoutStatus: 'succeeded' as const,
          announcementStatus: 'failed' as const,
          announcementMessageId: null,
        },
      ],
    };

    await store.save(enriched);

    expect(store.load()).toEqual(enriched);
    database.close();
  });

  it('imports the Railway state file once and never overwrites SQLite state', async () => {
    const { database, store } = createStore();
    const directory = await mkdtemp(join(tmpdir(), 'jcb-counting-import-'));
    try {
      const state = createInitialState({
        guildId: '100000000000000001',
        channelId: '100000000000000002',
        initialCount: '144',
        latestMessageId: '100000000000000003',
      });
      const path = join(directory, 'state.json');
      await writeFile(path, serializeState(state), 'utf8');

      await expect(store.importJsonIfEmpty(path)).resolves.toBe(true);
      await expect(store.importJsonIfEmpty(path)).resolves.toBe(false);
      expect(store.load()).toEqual(state);
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
