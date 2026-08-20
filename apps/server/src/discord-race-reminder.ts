import type { Client } from 'discord.js';
import { createHash } from 'node:crypto';

export async function sendRaceStartReminder(input: {
  readonly client: Client;
  readonly channelId: string;
  readonly roleId: string;
  readonly raceId: string;
  readonly raceVersion: number;
}): Promise<{ readonly channelId: string; readonly messageId: string }> {
  const channel = await input.client.channels.fetch(input.channelId);
  if (channel === null || !channel.isSendable()) {
    throw new Error('The #競馬 channel is not sendable.');
  }
  const message = await channel.send({
    content: `🚨 <@&${input.roleId}> あと５分で始まるよ！！！`,
    allowedMentions: {
      parse: [],
      roles: [input.roleId],
    },
    nonce: raceStartReminderNonce(input.raceId, input.raceVersion),
    enforceNonce: true,
  });
  return { channelId: input.channelId, messageId: message.id };
}

export async function deleteRaceStartReminder(input: {
  readonly client: Client;
  readonly channelId: string;
  readonly messageId: string;
}): Promise<void> {
  const channel = await input.client.channels.fetch(input.channelId);
  if (channel === null || !channel.isSendable() || !('messages' in channel)) {
    throw new Error('The #競馬 channel is not deletable.');
  }
  try {
    await channel.messages.delete(input.messageId);
  } catch (error) {
    if (!isMissingDiscordMessage(error)) throw error;
  }
}

export function raceStartReminderNonce(raceId: string, raceVersion: number): string {
  return createHash('sha256')
    .update(`race-start-reminder:${raceId}:${String(raceVersion)}`)
    .digest('hex')
    .slice(0, 25);
}

function isMissingDiscordMessage(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { readonly code?: unknown; readonly status?: unknown };
  return candidate.code === 10_008 || candidate.status === 404;
}
