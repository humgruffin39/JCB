import type { Config } from '../config.js';
import type { FailureExecutor } from '../discord/failureActions.js';
import type { ConsecutiveWarningNotifier } from '../discord/consecutiveWarning.js';
import type { Logger } from '../logging/logger.js';
import type { BotState } from '../persistence/stateSchema.js';
import type { StateStore } from '../persistence/stateStore.js';
import type { CountMessage } from './message.js';
import { applyMessage } from './stateMachine.js';

export class MessageProcessor {
  public constructor(
    private state: BotState,
    private readonly store: StateStore,
    private readonly failureExecutor: FailureExecutor,
    private readonly consecutiveWarningNotifier: ConsecutiveWarningNotifier,
    private readonly config: Pick<Config, 'guildId' | 'countChannelId' | 'timeoutSeconds'>,
    private readonly logger: Logger,
  ) {}

  public get currentState(): BotState {
    return this.state;
  }

  public async resumePendingFailures(): Promise<void> {
    this.state = await this.failureExecutor.resumeAll(this.state, async (updated) => {
      await this.store.save(updated);
      this.state = updated;
    });
  }

  public async process(message: CountMessage): Promise<void> {
    const transition = applyMessage(this.state, message, {
      guildId: this.config.guildId,
      channelId: this.config.countChannelId,
      timeoutSeconds: this.config.timeoutSeconds,
    });

    if (transition.kind === 'duplicate' || transition.kind === 'outside_scope') {
      return;
    }

    await this.store.save(transition.state);
    this.state = transition.state;

    if (transition.kind === 'accepted') {
      this.logger.info('message_accepted', {
        guildId: this.config.guildId,
        channelId: this.config.countChannelId,
        messageId: message.id,
        userId: message.authorId,
        currentCount: transition.acceptedCount,
      });
      return;
    }

    if (transition.kind === 'consecutive_rejected') {
      this.logger.info('consecutive_count_rejected', {
        guildId: this.config.guildId,
        channelId: this.config.countChannelId,
        messageId: message.id,
        userId: message.authorId,
        currentCount: transition.state.currentCount,
        expectedCount: transition.expectedCount,
      });
      await this.consecutiveWarningNotifier.notify({
        messageId: message.id,
        userId: message.authorId,
      });
      return;
    }

    if (transition.kind === 'failed') {
      this.logger.info('count_failed', {
        guildId: this.config.guildId,
        channelId: this.config.countChannelId,
        messageId: message.id,
        userId: message.authorId,
        currentCount: '0',
        expectedCount: transition.expectedCount,
      });
      await this.resumePendingFailures();
    }
  }

  public async flush(): Promise<void> {
    await this.store.save(this.state);
  }
}
