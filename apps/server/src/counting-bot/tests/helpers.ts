import type { CountMessage } from '../counting/message.js';
import {
  createInitialState,
  type BotState,
  type PendingFailure,
} from '../persistence/stateSchema.js';

export function message(overrides: Partial<CountMessage> = {}): CountMessage {
  return {
    id: '100',
    guildId: '10',
    channelId: '20',
    authorId: '30',
    authorIsBot: false,
    webhookId: null,
    isSystem: false,
    content: '1',
    createdTimestamp: Date.parse('2026-08-01T00:00:00.000Z'),
    attachmentCount: 0,
    stickerCount: 0,
    hasPoll: false,
    ...overrides,
  };
}

export function state(currentCount = '0', lastProcessedMessageId: string | null = null): BotState {
  return createInitialState({
    guildId: '10',
    channelId: '20',
    initialCount: currentCount,
    latestMessageId: lastProcessedMessageId,
    now: new Date('2026-08-01T00:00:00.000Z'),
  });
}

export function pendingFailure(overrides: Partial<PendingFailure> = {}): PendingFailure {
  return {
    failedMessageId: '100',
    failedUserId: '30',
    timeoutUntil: '2026-08-01T00:10:00.000Z',
    roleStatus: 'pending',
    timeoutStatus: 'pending',
    announcementStatus: 'pending',
    announcementMessageId: null,
    ...overrides,
  };
}
