import { type Message, type TextChannel } from 'discord.js';
import type { CountMessage } from '../counting/message.js';
import type { MessagePageSource } from '../counting/recovery.js';
import { retryOrThrow } from '../utilities/retry.js';
import { isPermanentDiscordError } from './errorClassification.js';

const discordRetryOptions = { isPermanent: isPermanentDiscordError };

export function toCountMessage(message: Message): CountMessage {
  return {
    id: message.id,
    guildId: message.guildId,
    channelId: message.channelId,
    authorId: message.author.id,
    authorDisplayName:
      message.member?.displayName ?? message.author.globalName ?? message.author.username,
    authorIsBot: message.author.bot,
    webhookId: message.webhookId,
    isSystem: message.system,
    content: message.content,
    createdTimestamp: message.createdTimestamp,
    attachmentCount: message.attachments.size,
    stickerCount: message.stickers.size,
    hasPoll: message.poll !== null,
  };
}

export class DiscordMessagePageSource implements MessagePageSource {
  public constructor(private readonly channel: TextChannel) {}

  public async fetchAfter(afterMessageId: string): Promise<readonly CountMessage[]> {
    const messages = await retryOrThrow(
      () =>
        this.channel.messages.fetch({
          after: afterMessageId,
          limit: 100,
        }),
      discordRetryOptions,
    );
    return messages.map(toCountMessage);
  }

  public async fetchLatest(beforeMessageId?: string): Promise<readonly CountMessage[]> {
    const messages = await retryOrThrow(
      () =>
        this.channel.messages.fetch({
          ...(beforeMessageId === undefined ? {} : { before: beforeMessageId }),
          limit: 100,
        }),
      discordRetryOptions,
    );
    return messages.map(toCountMessage);
  }
}

export async function fetchLatestMessageId(channel: TextChannel): Promise<string | null> {
  const messages = await retryOrThrow(
    () => channel.messages.fetch({ limit: 1 }),
    discordRetryOptions,
  );
  return messages.first()?.id ?? null;
}
