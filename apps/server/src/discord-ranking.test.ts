import { describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, openDatabase, SqliteGameStore } from '@jcb/database';
import type { Clock } from '@jcb/domain';
import type { Client } from 'discord.js';
import {
  publishWealthRankingMessage,
  publishRankingMessages,
  renderRankingMessages,
  renderWealthRankingEmbed,
  WEALTH_RANKING_CHANNEL_ID,
} from './discord-ranking.js';

describe('Discord fixed ranking messages', () => {
  it('splits all required metrics into no more than three messages', () => {
    const messages = renderRankingMessages({
      calculatedAt: 1_800_000_000_000,
      highestCarryover: '123456',
      users: Array.from({ length: 20 }, (_, index) => ({
        userId: `user-${String(index)}`,
        discordUserId: `1000000000000000${String(index).padStart(2, '0')}`,
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

  it('edits the persisted wealth ranking message after its first publication', async () => {
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
    const edit = vi.fn<(options: unknown) => Promise<void>>(async () => undefined);
    const send = vi.fn(async () => ({ id: 'wealth-message' }));
    const channel = {
      isSendable: () => true,
      messages: { fetch: vi.fn(async () => ({ edit })) },
      send,
    };
    const client = {
      channels: {
        fetch: vi.fn(async (channelId: string) => {
          expect(channelId).toBe(WEALTH_RANKING_CHANNEL_ID);
          return channel;
        }),
      },
    } as unknown as Client;
    const input = {
      client,
      database,
      clock: { now: () => 1 } as Clock,
      leaders: [{ discordUserId: '100000000000000000', currentBalance: '50000' }],
    };

    await publishWealthRankingMessage(input);
    await publishWealthRankingMessage(input);

    expect(send).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0]?.[0]).toMatchObject({
      allowedMentions: { parse: [], users: ['100000000000000000'] },
    });
    expect(
      database
        .prepare(
          "SELECT channel_id AS channelId, message_id AS messageId FROM discord_messages WHERE purpose = 'wealth-ranking'",
        )
        .get(),
    ).toEqual({ channelId: WEALTH_RANKING_CHANNEL_ID, messageId: 'wealth-message' });
    database.close();
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
