import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrivateObjectStore } from '@jcb/application';
import { parseEnvironment } from '@jcb/config';
import { applyMigrations, openDatabase, SqliteGameStore, SqliteJobStore } from '@jcb/database';
import { timestamp } from '@jcb/domain';
import type { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { createHandlers } from './scheduler-handlers.js';

const migrationsDirectory = join(
  dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
  'packages',
  'database',
  'migrations',
);

describe('scheduler cancellation cleanup', () => {
  it('publishes a disabled cancelled card and removes the start reminder reference', async () => {
    const now = 1_800_000_000_000;
    const database = openDatabase(':memory:');
    applyMigrations(database, migrationsDirectory, now);
    const game = new SqliteGameStore(database, () => now);
    game.initializeEconomy([]);
    const horses = Array.from({ length: 8 }, (_, index) =>
      game.createHorse({
        name: `更新試験馬${String(index + 1)}`,
        status: 'active',
        runningStyle: 'front_runner',
        speed: 50,
        start: 50,
        acceleration: 50,
        stamina: 50,
        lateKick: 50,
        conditionStability: 50,
        distancePreference: 0,
        surfacePreference: 0,
      }),
    );
    const draft = game.createRaceDraft({
      raceDate: '2026-08-21',
      name: '取消カード更新',
      distanceM: 1_200,
      surface: 'turf',
      scheduledAt: timestamp(now + 30_000),
      bettingOpensAt: timestamp(now + 10_000),
      bettingClosesAt: timestamp(now + 20_000),
      viewerOpensAt: timestamp(now + 10_000),
      entries: horses.map((horse, index) => ({ horseId: horse.id, horseNumber: index + 1 })),
    });
    const race = game.lockRace(draft.id, () => 0.5);
    database.prepare("UPDATE races SET status = 'cancelled' WHERE id = ?").run(race.id);
    database
      .prepare(
        `INSERT INTO discord_messages
         (id, purpose, race_id, channel_id, message_id, updated_at)
         VALUES ('race-row', 'race', ?, 'race-channel', 'race-message', ?),
                ('reminder-row', 'race_reminder', ?, 'race-channel', 'reminder-message', ?)`,
      )
      .run(race.id, BigInt(now), race.id, BigInt(now));
    const editRaceMessage = vi.fn<(options: unknown) => Promise<void>>();
    editRaceMessage.mockResolvedValue(undefined);
    const raceMessage = { edit: editRaceMessage };
    const channel = {
      isSendable: () => true,
      messages: {
        fetch: vi.fn(async () => raceMessage),
        delete: vi.fn(async () => undefined),
      },
    };
    const client = {
      channels: { fetch: vi.fn(async () => channel) },
    } as unknown as Client;
    const { privateKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      RESULT_MASTER_SECRET: randomBytes(32).toString('base64'),
      TIMELINE_MASTER_SECRET: randomBytes(32).toString('base64'),
      MANIFEST_PRIVATE_KEY: privateKey,
      DISCORD_RACE_CHANNEL_ID: '123456789',
    });
    const timelineStore: PrivateObjectStore = {
      async put() {
        return;
      },
      async get() {
        return undefined;
      },
      async delete() {
        return;
      },
      async list() {
        return [];
      },
    };
    const jobs = new SqliteJobStore(
      database,
      () => 0.5,
      () => now,
    );
    const handlers = createHandlers(
      {
        database,
        environment,
        clock: { now: () => timestamp(now) },
        timelineStore,
        discordClient: client,
      },
      jobs,
    );
    const job = jobs.enqueue({
      jobType: 'refresh_race_message',
      deduplicationKey: `refresh-race:${race.id}:${String(race.version)}:cancellation`,
      payload: { cancellationCleanup: true, raceId: race.id, raceVersion: race.version },
      runAt: timestamp(now),
    });

    try {
      await handlers.refresh_race_message!(job);
      expect(raceMessage.edit).toHaveBeenCalledTimes(1);
      const edit = raceMessage.edit.mock.calls[0]?.[0] as unknown as {
        readonly components: readonly [{ readonly components: readonly unknown[] }];
      };
      expect(edit.components[0]?.components[0]).toMatchObject({ data: { disabled: true } });
      expect(edit.components[0]?.components[4]).toMatchObject({ data: { disabled: true } });
      expect(channel.messages.delete).toHaveBeenCalledWith('reminder-message');
      expect(
        database
          .prepare("SELECT 1 FROM discord_messages WHERE purpose = 'race_reminder' AND race_id = ?")
          .get(race.id),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
