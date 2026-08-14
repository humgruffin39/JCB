import type { Message, TextChannel } from 'discord.js';
import type { Logger } from '../logging/logger.js';
import { retry } from '../utilities/retry.js';
import { isPermanentDiscordError } from './errorClassification.js';

export const consecutiveWarningText = '同じ人が連続でカウントすることはできないよ！';

export interface ConsecutiveWarningReply {
  readonly sourceMessageId: string;
  readonly userId: string;
  readonly content: string;
  readonly allowedMentions: {
    readonly users: readonly string[];
    readonly roles: readonly string[];
    readonly repliedUser: true;
  };
}

export interface ConsecutiveWarningAdapter {
  sendReply(reply: ConsecutiveWarningReply): Promise<{
    readonly id: string;
  }>;
  deleteSourceMessage(messageId: string): Promise<void>;
}

export class DiscordConsecutiveWarningAdapter implements ConsecutiveWarningAdapter {
  public constructor(private readonly channel: TextChannel) {}

  public async sendReply(reply: ConsecutiveWarningReply): Promise<Message> {
    return this.channel.send({
      content: reply.content,
      reply: {
        messageReference: reply.sourceMessageId,
        failIfNotExists: true,
      },
      allowedMentions: {
        users: [...reply.allowedMentions.users],
        roles: [...reply.allowedMentions.roles],
        repliedUser: reply.allowedMentions.repliedUser,
      },
    });
  }

  public async deleteSourceMessage(messageId: string): Promise<void> {
    try {
      await this.channel.messages.delete(messageId);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === 10_008) {
        return;
      }
      throw error;
    }
  }
}

export class ConsecutiveWarningNotifier {
  public constructor(
    private readonly adapter: ConsecutiveWarningAdapter,
    private readonly emojiText: string,
    private readonly logger: Logger,
  ) {}

  public async notify(input: {
    readonly messageId: string;
    readonly userId: string;
  }): Promise<void> {
    const content =
      `${this.emojiText} ${this.emojiText} ${this.emojiText} ` + consecutiveWarningText;
    const result = await retry(
      () =>
        this.adapter.sendReply({
          sourceMessageId: input.messageId,
          userId: input.userId,
          content,
          allowedMentions: {
            users: [input.userId],
            roles: [],
            repliedUser: true,
          },
        }),
      { isPermanent: isPermanentDiscordError },
    );

    if (result.kind === 'success') {
      this.logger.info('consecutive_warning_sent', {
        messageId: input.messageId,
        userId: input.userId,
        warningMessageId: result.value.id,
      });
    } else {
      this.logger.error('consecutive_warning_failed', result.error, {
        messageId: input.messageId,
        userId: input.userId,
        retryExhausted: result.kind === 'exhausted',
      });
    }

    const deletionResult = await retry(() => this.adapter.deleteSourceMessage(input.messageId), {
      isPermanent: isPermanentDiscordError,
    });
    if (deletionResult.kind === 'success') {
      this.logger.info('consecutive_count_message_deleted', {
        messageId: input.messageId,
        userId: input.userId,
      });
    } else {
      this.logger.error('consecutive_count_message_delete_failed', deletionResult.error, {
        messageId: input.messageId,
        userId: input.userId,
        retryExhausted: deletionResult.kind === 'exhausted',
      });
    }
  }
}
