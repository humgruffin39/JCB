import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, openDatabase, SqliteGameStore } from '@jcb/database';
import type { Clock } from '@jcb/domain';
import type { Client } from 'discord.js';
import { publishRankingMessages, renderRankingMessages } from './discord-ranking.js';

describe('Discord fixed ranking messages', () => {
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
