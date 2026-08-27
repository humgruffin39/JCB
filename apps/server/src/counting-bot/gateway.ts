import type { Environment } from '@jcb/config';
import type { SqliteDatabase } from '@jcb/database';
import type { Clock } from '@jcb/domain';
import { Events, type Client } from 'discord.js';
import { loadCountingConfig, type Config } from './config.js';
import type { CountMessage } from './counting/message.js';
import { SqliteCountEconomy } from './counting/economy.js';
import { MessageProcessor } from './counting/messageProcessor.js';
import { ProcessingQueue } from './counting/processingQueue.js';
import { fetchAllMessagesAfter, RecoveryBuffer } from './counting/recovery.js';
import { bestCommandName, registerBestCommand, replyWithBestCount } from './discord/bestCommand.js';
import {
  ConsecutiveWarningNotifier,
  DiscordConsecutiveWarningAdapter,
} from './discord/consecutiveWarning.js';
import { DiscordFailureActionAdapter, FailureExecutor } from './discord/failureActions.js';
import {
  DiscordMessagePageSource,
  fetchLatestMessageId,
  toCountMessage,
} from './discord/messageHandler.js';
import {
  legendCommandName,
  registerLegendCommand,
  replyWithCountLegend,
} from './discord/legendCommand.js';
import {
  rankingCommandName,
  registerRankingCommand,
  replyWithFailureRanking,
} from './discord/rankingCommand.js';
import { validateDiscordStartup } from './discord/startupValidation.js';
import { Logger } from './logging/logger.js';
import {
  applyLegendHistory20260801,
  legendHistory20260801ImportId,
} from './migrations/legendHistory20260801.js';
import { createInitialState, type BotState } from './persistence/stateSchema.js';
import { StateStore } from './persistence/stateStore.js';

export interface CountingGateway {
  readonly initialize: () => Promise<void>;
  readonly shutdown: () => Promise<void>;
}

export function wireCountingGateway(input: {
  readonly client: Client;
  readonly database: SqliteDatabase;
  readonly environment: Environment;
  readonly clock: Clock;
}): CountingGateway | undefined {
  const config = loadCountingConfig(input.environment);
  if (config === null) return undefined;

  const logger = new Logger('info');
  const recoveryBuffer = new RecoveryBuffer();
  const store = new StateStore(input.database, logger);
  let queue: ProcessingQueue<CountMessage> | null = null;
  let processor: MessageProcessor | null = null;
  let pageSource: DiscordMessagePageSource | null = null;
  let accepting = true;
  let initialized = false;
  let reconnectRecoveryRunning = false;
  let initializationPromise: Promise<void> | null = null;

  input.client.on(Events.MessageCreate, (message) => {
    if (
      !accepting ||
      message.guildId !== config.guildId ||
      message.channelId !== config.countChannelId
    ) {
      return;
    }
    const countMessage = toCountMessage(message);
    if (queue === null) {
      recoveryBuffer.ingest(countMessage);
      return;
    }
    recoveryBuffer.ingest(countMessage, queue);
  });

  input.client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.guildId !== config.guildId) {
      return;
    }

    const currentState = processor?.currentState ?? null;
    if (interaction.commandName === rankingCommandName) {
      void replyWithFailureRanking(interaction, currentState, logger).catch((error: unknown) => {
        logger.error('counting_ranking_command_failed', error, {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          userId: interaction.user.id,
        });
      });
      return;
    }
    if (interaction.commandName === bestCommandName) {
      void replyWithBestCount(interaction, currentState, logger).catch((error: unknown) => {
        logger.error('counting_best_command_failed', error, {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          userId: interaction.user.id,
        });
      });
      return;
    }
    if (interaction.commandName === legendCommandName) {
      void replyWithCountLegend(interaction, currentState, logger).catch((error: unknown) => {
        logger.error('counting_legend_command_failed', error, {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          userId: interaction.user.id,
        });
      });
    }
  });

  const beginReconnectRecovery = (): void => {
    if (
      !initialized ||
      reconnectRecoveryRunning ||
      pageSource === null ||
      processor === null ||
      queue === null ||
      !accepting
    ) {
      return;
    }

    reconnectRecoveryRunning = true;
    recoveryBuffer.begin();
    void (async () => {
      try {
        const activePageSource = pageSource;
        const activeProcessor = processor;
        const activeQueue = queue;
        if (activePageSource === null || activeProcessor === null || activeQueue === null) {
          return;
        }
        const recovered = await fetchAllMessagesAfter(
          activePageSource,
          activeProcessor.currentState.lastProcessedMessageId,
        );
        const completions = recoveryBuffer.release(recovered, activeQueue);
        await Promise.all(completions);
        logger.info('counting_discord_reconnected', {
          recoveredMessageCount: recovered.length,
        });
      } catch (error) {
        logger.error('counting_reconnect_recovery_failed', error);
      } finally {
        reconnectRecoveryRunning = false;
      }
    })();
  };

  input.client.on(Events.ShardDisconnect, (event, shardId) => {
    recoveryBuffer.begin();
    logger.warn('counting_discord_disconnected', {
      shardId,
      closeCode: event.code,
    });
  });
  input.client.on(Events.ShardReconnecting, () => {
    recoveryBuffer.begin();
  });
  input.client.on(Events.ShardResume, () => beginReconnectRecovery());
  input.client.on(Events.ShardReady, () => beginReconnectRecovery());
  input.client.on(Events.Error, (error) => {
    logger.error('counting_discord_client_error', error);
  });

  const initialize = async (): Promise<void> => {
    if (initializationPromise !== null) return initializationPromise;
    initializationPromise = initializeCounting();
    return initializationPromise;
  };

  const initializeCounting = async (): Promise<void> => {
    const resources = await validateDiscordStartup(input.client as Client<true>, config);
    logger.info('counting_startup_validation_succeeded', {
      guildId: config.guildId,
      channelId: config.countChannelId,
    });

    if (input.environment.COUNTING_STATE_IMPORT_PATH !== undefined) {
      await store.importJsonIfEmpty(input.environment.COUNTING_STATE_IMPORT_PATH, {
        guildId: config.guildId,
        channelId: config.countChannelId,
      });
    }

    const activePageSource = new DiscordMessagePageSource(resources.channel);
    pageSource = activePageSource;
    await registerRankingCommand(resources.guild, logger);
    await registerBestCommand(resources.guild, logger);
    await registerLegendCommand(resources.guild, logger);

    let state = store.load();
    if (state === null) {
      const latestMessageId = await fetchLatestMessageId(resources.channel);
      state = createInitialState({
        guildId: config.guildId,
        channelId: config.countChannelId,
        initialCount: config.initialCount,
        latestMessageId,
      });
      await store.save(state);
      logger.info('counting_state_initialized', {
        currentCount: state.currentCount,
        lastProcessedMessageId: state.lastProcessedMessageId,
      });
    } else {
      stateMatchesConfig(state, config);
    }

    const historyImport = applyLegendHistory20260801(state);
    if (historyImport.applied) {
      state = historyImport.state;
      await store.save(state);
      logger.info('counting_history_import_applied', {
        importId: legendHistory20260801ImportId,
        importedSuccessfulCount: historyImport.importedCount,
      });
    }

    const actionAdapter = new DiscordFailureActionAdapter(
      resources.guild,
      resources.channel,
      resources.botUserId,
    );
    const failureExecutor = new FailureExecutor(
      actionAdapter,
      config,
      resources.failureEmoji.toString(),
      logger,
    );
    const consecutiveWarningNotifier = new ConsecutiveWarningNotifier(
      new DiscordConsecutiveWarningAdapter(resources.channel),
      resources.consecutiveWarningEmoji.toString(),
      logger,
    );
    const initializedProcessor = new MessageProcessor(
      state,
      store,
      new SqliteCountEconomy(input.database, () => input.clock.now()),
      failureExecutor,
      consecutiveWarningNotifier,
      config,
      logger,
    );
    processor = initializedProcessor;
    const initializedQueue = new ProcessingQueue<CountMessage>(
      (message) => initializedProcessor.process(message),
      {
        onFatal: (error) => {
          logger.error('counting_queue_failed', error);
        },
      },
    );
    queue = initializedQueue;

    await initializedProcessor.resumePendingFailures();
    const recovered = await fetchAllMessagesAfter(
      activePageSource,
      initializedProcessor.currentState.lastProcessedMessageId,
    );
    const recoveryCompletions = recoveryBuffer.release(recovered, initializedQueue);
    await Promise.all(recoveryCompletions);
    initialized = true;
    logger.info('counting_ready', {
      guildId: config.guildId,
      channelId: config.countChannelId,
      recoveredMessageCount: recovered.length,
    });
  };

  const shutdown = async (): Promise<void> => {
    accepting = false;
    recoveryBuffer.stopAccepting();
    queue?.stopAccepting();
    await queue?.waitForIdle();
    await processor?.flush();
  };

  return { initialize, shutdown };
}

function stateMatchesConfig(state: BotState, config: Config): void {
  if (state.guildId !== config.guildId || state.channelId !== config.countChannelId) {
    throw new Error(
      'Persisted Counting state belongs to a different guild or channel; refusing to reset it.',
    );
  }
}
