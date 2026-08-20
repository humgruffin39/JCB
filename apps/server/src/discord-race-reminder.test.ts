import type { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  deleteRaceStartReminder,
  raceStartReminderNonce,
  sendRaceStartReminder,
} from './discord-race-reminder.js';

const racingRoleId = '1539853436823015484';

function clientFor(channel: unknown): Client {
  return {
    channels: {
      fetch: vi.fn(async () => channel),
    },
  } as unknown as Client;
}

describe('race start reminder', () => {
  it('sends the role mention with a deterministic nonce', async () => {
    const send = vi.fn(async () => ({ id: 'message-1' }));
    const client = clientFor({ isSendable: () => true, send });

    await expect(
      sendRaceStartReminder({
        client,
        channelId: 'race-channel',
        roleId: racingRoleId,
        raceId: 'race-1',
        raceVersion: 3,
      }),
    ).resolves.toEqual({ channelId: 'race-channel', messageId: 'message-1' });
    expect(send).toHaveBeenCalledWith({
      content: `🚨 <@&${racingRoleId}> あと５分で始まるよ！！！`,
      allowedMentions: { parse: [], roles: [racingRoleId] },
      nonce: raceStartReminderNonce('race-1', 3),
      enforceNonce: true,
    });
    expect(raceStartReminderNonce('race-1', 3)).toBe(raceStartReminderNonce('race-1', 3));
    expect(raceStartReminderNonce('race-1', 3)).not.toBe(raceStartReminderNonce('race-1', 4));
  });

  it('treats an already deleted reminder as successful', async () => {
    for (const error of [
      Object.assign(new Error('Unknown Message'), { code: 10_008 }),
      Object.assign(new Error('Not Found'), { status: 404 }),
    ]) {
      const remove = vi.fn(async () => {
        throw error;
      });
      const client = clientFor({
        isSendable: () => true,
        messages: { delete: remove },
      });

      await expect(
        deleteRaceStartReminder({
          client,
          channelId: 'race-channel',
          messageId: 'message-1',
        }),
      ).resolves.toBeUndefined();
      expect(remove).toHaveBeenCalledWith('message-1');
    }
  });

  it('rethrows deletion failures other than missing-message responses', async () => {
    const failure = new Error('Discord unavailable');
    const remove = vi.fn(async () => {
      throw failure;
    });
    const client = clientFor({
      isSendable: () => true,
      messages: { delete: remove },
    });

    await expect(
      deleteRaceStartReminder({
        client,
        channelId: 'race-channel',
        messageId: 'message-1',
      }),
    ).rejects.toBe(failure);
  });
});
