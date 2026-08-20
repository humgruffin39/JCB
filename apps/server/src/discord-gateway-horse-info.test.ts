import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, openDatabase, SqliteGameStore, type HorseWrite } from '@jcb/database';
import type { Environment } from '@jcb/config';
import { timestamp } from '@jcb/domain';
import { Events, type Client, type Interaction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { publishRaceMessage, wireDiscordGateway } from './discord-gateway.js';

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'database',
  'migrations',
);

const horseBase: Omit<HorseWrite, 'name'> = {
  status: 'active',
  runningStyle: 'front_runner',
  speed: 20,
  start: 30,
  acceleration: 40,
  stamina: 50,
  lateKick: 60,
  conditionStability: 70,
  distancePreference: 80,
  surfacePreference: 90,
};

function createRaces() {
  const database = openDatabase(':memory:');
  applyMigrations(database, migrationsDirectory, 1);
  const game = new SqliteGameStore(database, () => 1);
  const horses = Array.from({ length: 8 }, (_, index) =>
    game.createHorse({ ...horseBase, name: `経路馬${String(index + 1)}` }),
  );
  const createRace = (name: string, viewerOpensAt: number) => {
    const race = game.createRaceDraft({
      raceDate: '2026-08-20',
      name,
      distanceM: 1200,
      surface: 'turf',
      scheduledAt: timestamp(viewerOpensAt + 100),
      bettingOpensAt: timestamp(Math.max(1, viewerOpensAt - 100)),
      bettingClosesAt: timestamp(viewerOpensAt + 50),
      viewerOpensAt: timestamp(viewerOpensAt),
      entries: horses.map((horse, index) => ({ horseId: horse.id, horseNumber: index + 1 })),
    });
    game.lockRace(race.id, () => 0.5);
    database.prepare("UPDATE races SET status = 'betting_open' WHERE id = ?").run(race.id);
    return race.id;
  };
  return { database, game, createRace };
}

function createEnvironment(): Environment {
  return {
    DISCORD_GUILD_ID: 'guild-1',
    DISCORD_RACE_CHANNEL_ID: 'new-channel',
  } as Environment;
}

function createClient(channels: Readonly<Record<string, unknown>> = {}) {
  const handlers = new Map<string, (interaction: Interaction) => unknown>();
  const client = {
    on: vi.fn((event: string, handler: (interaction: Interaction) => unknown) => {
      handlers.set(event, handler);
    }),
    once: vi.fn((event: string, handler: (interaction: Interaction) => unknown) => {
      handlers.set(event, handler);
    }),
    guilds: {
      fetch: vi.fn(async () => ({ members: { fetch: vi.fn(async () => undefined) } })),
    },
    channels: {
      fetch: vi.fn(async (channelId: string) => channels[channelId] ?? null),
    },
  } as unknown as Client;
  return { client, handlers };
}

function createButtonInteraction(customId: string) {
  return {
    guildId: 'guild-1',
    user: { id: 'user-1', globalName: '利用者', username: 'user' },
    customId,
    channelId: 'new-channel',
    deferred: false,
    replied: false,
    isButton: () => true,
    isChatInputCommand: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    reply: vi.fn(async () => undefined),
    launchActivity: vi.fn(async () => undefined),
  } as unknown as Interaction & {
    readonly reply: ReturnType<typeof vi.fn>;
    readonly launchActivity: ReturnType<typeof vi.fn>;
  };
}

async function dispatch(
  handlers: ReadonlyMap<string, (interaction: Interaction) => unknown>,
  interaction: Interaction,
): Promise<void> {
  handlers.get(Events.InteractionCreate)?.(interaction);
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('Discord horse information gateway path', () => {
  it('replies with one ephemeral eight-horse embed', async () => {
    const { database, game, createRace } = createRaces();
    game.initializeEconomy([]);
    game.registerUser('user-1', '利用者', true);
    const raceId = createRace('馬情報経路', 100);
    const { client, handlers } = createClient();
    wireDiscordGateway({
      client,
      database,
      environment: createEnvironment(),
      clock: { now: () => timestamp(200) },
    });
    const interaction = createButtonInteraction(`jcb:horse-info:${raceId}`);

    await dispatch(handlers, interaction);

    const replyMock = Reflect.get(interaction, 'reply') as unknown as ReturnType<typeof vi.fn>;
    expect(replyMock).toHaveBeenCalledTimes(1);
    const reply = replyMock.mock.calls[0]?.[0] as {
      readonly embeds: readonly [
        {
          readonly data: {
            readonly fields?: readonly { readonly name: string; readonly inline?: boolean }[];
            readonly title?: string;
          };
        },
      ];
      readonly flags: number;
      readonly components: readonly unknown[];
    };
    expect(reply.flags).toBe(64);
    expect(reply.components).toEqual([]);
    expect(reply.embeds[0]?.data.title).toBe('出走馬情報');
    expect(reply.embeds[0]?.data.fields).toHaveLength(8);
    expect(reply.embeds[0]?.data.fields?.[0]).toMatchObject({
      name: '<:horse_1:1539913567787159653> 経路馬1',
      inline: false,
    });
    expect(Reflect.get(client.guilds, 'fetch')).not.toHaveBeenCalled();
    database.close();
  });

  it('rejects an old direct view button after a newer race opens', async () => {
    const { database, game, createRace } = createRaces();
    game.initializeEconomy([]);
    game.registerUser('user-1', '利用者', true);
    const oldRaceId = createRace('旧経路', 100);
    const newRaceId = createRace('新経路', 1_000_000);
    const { client, handlers } = createClient();
    wireDiscordGateway({
      client,
      database,
      environment: createEnvironment(),
      clock: { now: () => timestamp(2_000_000) },
    });
    const interaction = createButtonInteraction(`jcb:view:${oldRaceId}`);

    await dispatch(handlers, interaction);

    const replyMock = Reflect.get(interaction, 'reply') as unknown as ReturnType<typeof vi.fn>;
    expect(replyMock).toHaveBeenCalledWith({
      content: 'このレースの公開は終了しました。最新レースから観戦してください。',
      components: [],
      flags: 64,
    });
    const launchActivityMock = Reflect.get(interaction, 'launchActivity') as unknown as ReturnType<
      typeof vi.fn
    >;
    expect(launchActivityMock).not.toHaveBeenCalled();
    expect(newRaceId).not.toBe(oldRaceId);
    database.close();
  });
});

describe('Discord race message viewer invalidation', () => {
  it('updates past cards only when the open-viewer refresh requests it', async () => {
    const { database, createRace } = createRaces();
    const oldRaceId = createRace('旧カード', 100);
    const newRaceId = createRace('新カード', 1_000_000);
    const oldMessage = { edit: vi.fn(async () => undefined) };
    const newMessage = { edit: vi.fn(async () => undefined) };
    const oldChannel = {
      isSendable: () => true,
      isTextBased: () => true,
      messages: { fetch: vi.fn(async () => oldMessage) },
    };
    const newChannel = {
      isSendable: () => true,
      isTextBased: () => true,
      messages: { fetch: vi.fn(async () => newMessage) },
    };
    database
      .prepare(
        `INSERT INTO discord_messages
         (id, purpose, race_id, channel_id, message_id, updated_at)
         VALUES ('old-message-row', 'race', ?, 'old-channel', 'old-message', 1),
                ('new-message-row', 'race', ?, 'new-channel', 'new-message', 1)`,
      )
      .run(oldRaceId, newRaceId);
    const { client } = createClient({
      'old-channel': oldChannel,
      'new-channel': newChannel,
    });
    const input = {
      client,
      database,
      environment: createEnvironment(),
      clock: { now: () => timestamp(2_000_000) },
      raceId: newRaceId,
    };

    await publishRaceMessage({ ...input, disablePreviousViewers: true });
    expect(oldMessage.edit).toHaveBeenCalledTimes(1);
    const oldEditPayload = (
      oldMessage.edit.mock.calls as unknown as readonly [unknown][]
    )?.[0]?.[0] as {
      readonly components: readonly [{ readonly components: readonly unknown[] }];
    };
    expect(oldEditPayload.components[0]?.components[4]).toMatchObject({
      data: { disabled: true },
    });

    oldMessage.edit.mockClear();
    await publishRaceMessage(input);
    expect(oldMessage.edit).not.toHaveBeenCalled();
    database.close();
  });
});
