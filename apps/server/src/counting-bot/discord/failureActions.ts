import type { Guild, TextChannel } from 'discord.js';
import type { Config } from '../config.js';
import type { Logger } from '../logging/logger.js';
import type { BotState, FailureActionStatus, PendingFailure } from '../persistence/stateSchema.js';
import { retry, type RetryOptions, type RetryResult } from '../utilities/retry.js';
import { isPermanentDiscordError } from './errorClassification.js';

export interface FailureAnnouncement {
  readonly failedMessageId: string;
  readonly failedUserId: string;
  readonly content: string;
  readonly allowedMentions: {
    readonly users: readonly string[];
    readonly roles: readonly string[];
    readonly repliedUser: false;
  };
}

export interface FailureActionAdapter {
  addRole(userId: string, roleId: string): Promise<void>;
  applyTimeout(userId: string, timeoutUntil: Date): Promise<void>;
  findExistingAnnouncement(failedMessageId: string): Promise<string | null>;
  sendAnnouncement(announcement: FailureAnnouncement): Promise<string>;
}

export class DiscordFailureActionAdapter implements FailureActionAdapter {
  public constructor(
    private readonly guild: Guild,
    private readonly channel: TextChannel,
    private readonly botUserId: string,
  ) {}

  public async addRole(userId: string, roleId: string): Promise<void> {
    const member = await this.guild.members.fetch(userId);
    await member.roles.add(roleId, 'Counting failure');
  }

  public async applyTimeout(userId: string, timeoutUntil: Date): Promise<void> {
    const member = await this.guild.members.fetch(userId);
    await member.disableCommunicationUntil(timeoutUntil, 'Counting failure');
  }

  public async findExistingAnnouncement(failedMessageId: string): Promise<string | null> {
    const messages = await this.channel.messages.fetch({
      after: failedMessageId,
      limit: 100,
    });
    const existing = messages.find(
      (message) =>
        message.author.id === this.botUserId && message.reference?.messageId === failedMessageId,
    );
    return existing?.id ?? null;
  }

  public async sendAnnouncement(announcement: FailureAnnouncement): Promise<string> {
    const sent = await this.channel.send({
      content: announcement.content,
      reply: {
        messageReference: announcement.failedMessageId,
        failIfNotExists: false,
      },
      allowedMentions: {
        users: [...announcement.allowedMentions.users],
        roles: [...announcement.allowedMentions.roles],
        repliedUser: announcement.allowedMentions.repliedUser,
      },
    });
    return sent.id;
  }
}

export interface FailureExecutorOptions {
  readonly retry?: RetryOptions;
  readonly now?: () => Date;
}

type PersistState = (state: BotState) => Promise<void>;

function replaceFailure(state: BotState, updated: PendingFailure, now: Date): BotState {
  return {
    ...state,
    pendingFailures: state.pendingFailures.map((failure) =>
      failure.failedMessageId === updated.failedMessageId ? updated : failure,
    ),
    updatedAt: now.toISOString(),
  };
}

function removeFailure(state: BotState, failedMessageId: string, now: Date): BotState {
  return {
    ...state,
    pendingFailures: state.pendingFailures.filter(
      (failure) => failure.failedMessageId !== failedMessageId,
    ),
    updatedAt: now.toISOString(),
  };
}

function allActionsTerminal(failure: PendingFailure): boolean {
  return [failure.roleStatus, failure.timeoutStatus, failure.announcementStatus].every(
    (status) => status !== 'pending',
  );
}

export class FailureExecutor {
  public constructor(
    private readonly adapter: FailureActionAdapter,
    private readonly config: Pick<Config, 'penaltyRoleId'>,
    private readonly failureEmojiText: string,
    private readonly logger: Logger,
    private readonly options: FailureExecutorOptions = {},
  ) {}

  public async resumeAll(initialState: BotState, persist: PersistState): Promise<BotState> {
    let state = initialState;
    for (const pending of [...state.pendingFailures]) {
      state = await this.executeOne(state, pending.failedMessageId, persist);
    }
    return state;
  }

  private async executeOne(
    initialState: BotState,
    failedMessageId: string,
    persist: PersistState,
  ): Promise<BotState> {
    let state = initialState;
    let failure = state.pendingFailures.find(
      (candidate) => candidate.failedMessageId === failedMessageId,
    );
    if (failure === undefined) {
      return state;
    }

    if (failure.roleStatus === 'pending') {
      const result = await this.attempt(() =>
        this.adapter.addRole(failure!.failedUserId, this.config.penaltyRoleId),
      );
      const status = this.actionStatus(result);
      if (status !== null) {
        failure = { ...failure, roleStatus: status };
        state = replaceFailure(state, failure, this.now());
        await persist(state);
      }
      if (result.kind === 'success') {
        this.logger.info('role_added', this.logFields(failure));
      } else {
        this.logger.error('role_add_failed', result.error, {
          ...this.logFields(failure),
          retryExhausted: result.kind === 'exhausted',
        });
      }
    }

    if (failure.timeoutStatus === 'pending') {
      const timeoutUntil = new Date(failure.timeoutUntil);
      if (timeoutUntil.getTime() <= this.now().getTime()) {
        failure = { ...failure, timeoutStatus: 'skipped' };
        state = replaceFailure(state, failure, this.now());
        await persist(state);
        this.logger.info('timeout_skipped', this.logFields(failure));
      } else {
        const result = await this.attempt(() =>
          this.adapter.applyTimeout(failure!.failedUserId, timeoutUntil),
        );
        const status = this.actionStatus(result);
        if (status !== null) {
          failure = { ...failure, timeoutStatus: status };
          state = replaceFailure(state, failure, this.now());
          await persist(state);
        }
        if (result.kind === 'success') {
          this.logger.info('timeout_applied', {
            ...this.logFields(failure),
            timeoutUntil: failure.timeoutUntil,
          });
        } else {
          this.logger.error('timeout_failed', result.error, {
            ...this.logFields(failure),
            retryExhausted: result.kind === 'exhausted',
          });
        }
      }
    }

    if (failure.announcementStatus === 'pending') {
      const announcementResult = await this.sendOrFindAnnouncement(failure);
      const status = this.actionStatus(announcementResult);
      if (status !== null) {
        failure = {
          ...failure,
          announcementStatus: status,
          announcementMessageId:
            announcementResult.kind === 'success'
              ? announcementResult.value
              : failure.announcementMessageId,
        };
        state = replaceFailure(state, failure, this.now());
        await persist(state);
      }
      if (announcementResult.kind === 'success') {
        this.logger.info('failure_announcement_sent', {
          ...this.logFields(failure),
          announcementMessageId: announcementResult.value,
        });
      } else {
        this.logger.error('failure_announcement_failed', announcementResult.error, {
          ...this.logFields(failure),
          retryExhausted: announcementResult.kind === 'exhausted',
        });
      }
    }

    if (allActionsTerminal(failure)) {
      state = removeFailure(state, failure.failedMessageId, this.now());
      await persist(state);
    }
    return state;
  }

  private async sendOrFindAnnouncement(failure: PendingFailure): Promise<RetryResult<string>> {
    return this.attempt(async () => {
      const existing = await this.adapter.findExistingAnnouncement(failure.failedMessageId);
      if (existing !== null) {
        return existing;
      }

      const content =
        this.failureEmojiText.repeat(3) +
        `<@${failure.failedUserId}> が失敗した!!️` +
        this.failureEmojiText.repeat(3);
      return this.adapter.sendAnnouncement({
        failedMessageId: failure.failedMessageId,
        failedUserId: failure.failedUserId,
        content,
        allowedMentions: {
          users: [failure.failedUserId],
          roles: [],
          repliedUser: false,
        },
      });
    });
  }

  private attempt<T>(operation: () => Promise<T>): Promise<RetryResult<T>> {
    return retry(operation, {
      ...this.options.retry,
      isPermanent: this.options.retry?.isPermanent ?? isPermanentDiscordError,
    });
  }

  private actionStatus(result: RetryResult<unknown>): FailureActionStatus | null {
    if (result.kind === 'success') {
      return 'succeeded';
    }
    if (result.kind === 'permanent_failure') {
      return 'failed';
    }
    return null;
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private logFields(failure: PendingFailure): Record<string, unknown> {
    return {
      messageId: failure.failedMessageId,
      userId: failure.failedUserId,
    };
  }
}
