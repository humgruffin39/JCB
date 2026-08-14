import type { CountMessage } from './message.js';
import { parseCountCandidate } from './parser.js';
import type { BotState, PendingFailure } from '../persistence/stateSchema.js';
import { compareSnowflakes } from '../utilities/snowflake.js';

export type StateTransition =
  | { readonly kind: 'duplicate'; readonly state: BotState }
  | { readonly kind: 'outside_scope'; readonly state: BotState }
  | { readonly kind: 'ignored'; readonly state: BotState }
  | {
      readonly kind: 'accepted';
      readonly state: BotState;
      readonly acceptedCount: string;
    }
  | {
      readonly kind: 'consecutive_rejected';
      readonly state: BotState;
      readonly expectedCount: string;
    }
  | {
      readonly kind: 'failed';
      readonly state: BotState;
      readonly expectedCount: string;
    };

export interface StateMachineOptions {
  readonly guildId: string;
  readonly channelId: string;
  readonly timeoutSeconds: number;
  readonly now?: () => Date;
}

function withProcessedMessage(state: BotState, messageId: string, updatedAt: string): BotState {
  return {
    ...state,
    lastProcessedMessageId: messageId,
    updatedAt,
  };
}

export function applyMessage(
  state: BotState,
  message: CountMessage,
  options: StateMachineOptions,
): StateTransition {
  if (message.guildId !== options.guildId || message.channelId !== options.channelId) {
    return { kind: 'outside_scope', state };
  }

  if (
    state.lastProcessedMessageId !== null &&
    compareSnowflakes(message.id, state.lastProcessedMessageId) <= 0
  ) {
    return { kind: 'duplicate', state };
  }

  const updatedAt = (options.now ?? (() => new Date()))().toISOString();
  if (message.authorIsBot || message.webhookId !== null || message.isSystem) {
    return {
      kind: 'ignored',
      state: withProcessedMessage(state, message.id, updatedAt),
    };
  }

  const candidate =
    message.attachmentCount === 0 && message.stickerCount === 0 && !message.hasPoll
      ? parseCountCandidate(message.content)
      : null;
  const expected = BigInt(state.currentCount) + 1n;

  if (candidate === expected && state.lastCounterUserId === message.authorId) {
    return {
      kind: 'consecutive_rejected',
      expectedCount: expected.toString(),
      state: withProcessedMessage(state, message.id, updatedAt),
    };
  }

  if (candidate === expected) {
    const acceptedCount = candidate.toString();
    const previousSuccessfulCount = BigInt(state.successfulCounts[message.authorId] ?? '0');
    return {
      kind: 'accepted',
      acceptedCount,
      state: {
        ...state,
        currentCount: acceptedCount,
        bestCount: candidate > BigInt(state.bestCount) ? acceptedCount : state.bestCount,
        successfulCounts: {
          ...state.successfulCounts,
          [message.authorId]: (previousSuccessfulCount + 1n).toString(),
        },
        lastProcessedMessageId: message.id,
        lastAcceptedMessageId: message.id,
        lastCounterUserId: message.authorId,
        updatedAt,
      },
    };
  }

  const timeoutUntil = new Date(
    message.createdTimestamp + options.timeoutSeconds * 1_000,
  ).toISOString();
  const pendingFailure: PendingFailure = {
    failedMessageId: message.id,
    failedUserId: message.authorId,
    timeoutUntil,
    roleStatus: 'pending',
    timeoutStatus: 'pending',
    announcementStatus: 'pending',
    announcementMessageId: null,
  };
  const previousFailureCount = BigInt(state.failureCounts[message.authorId] ?? '0');

  return {
    kind: 'failed',
    expectedCount: expected.toString(),
    state: {
      ...state,
      currentCount: '0',
      lastProcessedMessageId: message.id,
      lastAcceptedMessageId: null,
      lastCounterUserId: null,
      failureCounts: {
        ...state.failureCounts,
        [message.authorId]: (previousFailureCount + 1n).toString(),
      },
      pendingFailures: [...state.pendingFailures, pendingFailure],
      updatedAt,
    },
  };
}
