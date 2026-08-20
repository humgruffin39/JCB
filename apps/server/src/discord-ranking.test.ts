import { describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, openDatabase, SqliteAdminStore, SqliteGameStore } from '@jcb/database';
import type { Clock } from '@jcb/domain';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import {
  FORBES_COMMAND_NAME,
  publishRankingMessages,
  readWealthRankingLeaders,
  registerForbesCommand,
  replyWithForbesRanking,
  renderRankingMessages,
  renderWealthRankingEmbed,
} from './discord-ranking.js';

describe('Discord rankings', () => {
  it('excludes accounts that have only received their initial grant', () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(
        dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
        '..',
        'packages',
        'database',
        'migrations',
      ),
      1,
    );
    const game = new SqliteGameStore(database, () => 1);
    game.initializeEconomy([]);
    const active = game.registerUser('100000000000000001', '参加者', true);
    game.registerUser('100000000000000002', '初期状態', true);
    new SqliteAdminStore(database, () => 2).adjustBalance({
      targetAccountId: active.accountId,
      signedAmount: 1n,
      reason: '番付対象の確認',
      idempotencyKey: 'wealth-ranking-activity',
      actorUserId: active.id,
    });

    expect(readWealthRankingLeaders(database)).toEqual([
      { discordUserId: '100000000000000001', currentBalance: '50001' },
    ]);
    database.close();
  });

  it('registers the forbes guild command', async () => {
    const create = vi.fn(async () => ({ id: 'forbes-command' }));
    const client = {
      guilds: {
        fetch: vi.fn(async () => ({
          commands: { fetch: vi.fn(async () => []), create, edit: vi.fn() },
        })),
      },
    } as unknown as Client;

    await registerForbesCommand({ client, guildId: 'guild-1' });

    expect(create).toHaveBeenCalledWith({
      name: FORBES_COMMAND_NAME,
      description: '現在の長者番付を表示します',
      options: [],
    });
  });

  it('replies publicly with the current ranking embed', async () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(
        dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
        '..',
        'packages',
        'database',
        'migrations',
      ),
      1,
    );
    const game = new SqliteGameStore(database, () => 1);
    game.initializeEconomy([]);
    const active = game.registerUser('100000000000000001', '参加者', true);
    new SqliteAdminStore(database, () => 2).adjustBalance({
      targetAccountId: active.accountId,
      signedAmount: 1n,
      reason: '番付応答の確認',
      idempotencyKey: 'forbes-command-reply',
      actorUserId: active.id,
    });
    const reply = vi.fn<(options: unknown) => Promise<void>>(async () => undefined);

    await replyWithForbesRanking({
      interaction: { reply } as unknown as ChatInputCommandInteraction,
      database,
    });

    expect(reply).toHaveBeenCalledTimes(1);
    const response = reply.mock.calls[0]?.[0] as unknown as {
      readonly embeds: readonly [{ readonly data: { readonly description?: string } }];
      readonly allowedMentions: { readonly parse: readonly string[] };
      readonly flags?: unknown;
    };
    expect(response.embeds[0]?.data.description).toBe('**１位** <@100000000000000001> 50,001CP');
    expect(response.allowedMentions).toEqual({ parse: [] });
    expect(response.flags).toBeUndefined();
    database.close();
  });

  it('splits all required metrics into no more than three messages', () => {
    const messages = renderRankingMessages({
      calculatedAt: 1_800_000_000_000,
      highestCarryover: '123456',
      users: Array.from({ length: 20 }, (_, index) => ({
        userId: `user-${String(index)}`,
        displayName: `利用者_${String(index + 1)}@everyone`,
        currentBalance: String(50_000 + index),
        lifetimeProfit: String(index - 5),
        totalPayout: String(index * 1_000),
        winHitRateBasisPoints: index * 100,
        trifectaWins: index,
        maximumPayout: String(index * 500),
        currentLosingStreak: index,
        longestLosingStreak: index + 2,
      })),
    });

    expect(messages).toHaveLength(3);
    expect(messages.every((message) => message.length <= 2_000)).toBe(true);
    expect(messages.join('\n')).toContain('キャリーオーバー歴代最高額');
    expect(messages.join('\n')).not.toContain('@everyone');
  });

  it('renders only the top five balances as a concise wealth ranking embed', () => {
    const embed = renderWealthRankingEmbed(
      Array.from({ length: 6 }, (_, index) => ({
        discordUserId: `10000000000000000${String(index)}`,
        currentBalance: String(50_000 - index * 1_000),
      })),
    ).toJSON();

    expect(embed.title).toBe('長者番付');
    expect(embed.description).toBe(
      [
        '**１位** <@100000000000000000> 50,000CP',
        '**２位** <@100000000000000001> 49,000CP',
        '**３位** <@100000000000000002> 48,000CP',
        '**４位** <@100000000000000003> 47,000CP',
        '**５位** <@100000000000000004> 46,000CP',
      ].join('\n'),
    );
    expect(embed.footer).toBeUndefined();
    expect(embed.fields).toBeUndefined();
  });

  it('recreates deleted fixed messages and persists their replacement IDs', async () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(
        dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
        '..',
        'packages',
        'database',
        'migrations',
      ),
      1,
    );
    new SqliteGameStore(database, () => 1).initializeEconomy([]);
    let nextId = 0;
    const sent: string[] = [];
    const channel = {
      isSendable: () => true,
      messages: {
        async fetch() {
          throw new Error('Discord message was deleted.');
        },
      },
      async send() {
        nextId += 1;
        const id = `message-${String(nextId)}`;
        sent.push(id);
        return { id };
      },
    };
    const client = {
      channels: {
        async fetch() {
          return channel;
        },
      },
    } as unknown as Client;
    const clock = { now: () => 1 } as Clock;
    await publishRankingMessages({ client, database, clock, channelId: 'ranking' });
    await publishRankingMessages({ client, database, clock, channelId: 'ranking' });
    expect(sent).toHaveLength(6);
    const stored = database
      .prepare("SELECT message_id AS messageId FROM discord_messages WHERE purpose = 'ranking:1'")
      .get() as { messageId: string };
    expect(stored.messageId).toBe('message-4');
    database.close();
  });
});
