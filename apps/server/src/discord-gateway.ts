import type { Environment } from '@jcb/config';
import {
  SqliteActivityStore,
  SqliteAuthStore,
  SqliteDiscordMessageStore,
  SqliteGameStore,
  SqliteInteractionSessionStore,
  SqliteViewerStore,
  type SqliteDatabase,
} from '@jcb/database';
import {
  handlePurchaseInteraction,
  horseSelectionEmojis,
  renderHorseInfoMessage,
  renderRaceMessage,
} from '@jcb/discord';
import { DomainError, money, POOL_TYPE_DEFINITIONS, timestamp, type Clock } from '@jcb/domain';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type Interaction,
} from 'discord.js';
import type { EmbedBuilder } from 'discord.js';
import { createHash } from 'node:crypto';
import { DiscordClientGuildMembership } from './guild-membership.js';
import { SqliteDiscordPurchaseGateway } from './discord-purchase-gateway.js';
import {
  FORBES_COMMAND_NAME,
  registerForbesCommand,
  replyWithForbesRanking,
} from './discord-ranking.js';
import { resolveFinishOrder } from './discord-race-message-options.js';
import {
  latestViewableRaceId,
  listDiscordRaceMessages,
  readDiscordHorseInfo,
} from './discord-horse-info.js';

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    allowedMentions: { parse: [] },
  });
}

export function wireDiscordGateway(input: {
  readonly client: Client;
  readonly database: SqliteDatabase;
  readonly environment: Environment;
  readonly clock: Clock;
}): void {
  const guildId = requireConfigured(input.environment.DISCORD_GUILD_ID, 'DISCORD_GUILD_ID');
  const membership = new DiscordClientGuildMembership(input.client, guildId);
  const gameStore = new SqliteGameStore(input.database, () => input.clock.now());
  const activityStore = new SqliteActivityStore(input.database, () => input.clock.now());
  const authStore = new SqliteAuthStore(input.database, () => input.clock.now());
  const viewerStore = new SqliteViewerStore(input.database);
  const sessions = new SqliteInteractionSessionStore(input.database, () => input.clock.now());
  const gateway = new SqliteDiscordPurchaseGateway(input.database, input.clock, membership);

  input.client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction).catch(reportDiscordError);
  });
  input.client.once(Events.ClientReady, () => {
    void registerForbesCommand({ client: input.client, guildId }).catch(reportDiscordError);
  });

  async function handleInteraction(interaction: Interaction): Promise<void> {
    try {
      if (interaction.guildId !== guildId) {
        await safeEphemeralReply(interaction, 'このDiscordサーバーでは利用できません。');
        return;
      }
      gameStore.registerUser(
        interaction.user.id,
        interaction.user.globalName ?? interaction.user.username,
        true,
      );
      if (interaction.isChatInputCommand() && interaction.commandName === FORBES_COMMAND_NAME) {
        await replyWithForbesRanking({ interaction, database: input.database });
        return;
      }
      if (
        await handlePurchaseInteraction(interaction, {
          sessions,
          gateway,
          clock: input.clock,
        })
      ) {
        return;
      }
      if (!interaction.isButton()) return;
      const [prefix, action, raceId] = interaction.customId.split(':');
      if (prefix !== 'jcb') return;
      if ((action === 'detail' || action === 'view') && raceId !== undefined) {
        const race = viewerStore.getRaceDetail(raceId);
        if (action === 'view' && input.clock.now() < race.viewerOpensAt) {
          await safeEphemeralReply(
            interaction,
            `観戦導線は ${formatJst(race.viewerOpensAt)} に開きます。`,
          );
          return;
        }
        if (action === 'view') {
          if (latestViewableRaceId(input.database, input.clock.now()) !== raceId) {
            await safeEphemeralReply(
              interaction,
              'このレースの公開は終了しました。最新レースから観戦してください。',
            );
            return;
          }
          if (interaction.channelId === null) {
            await safeEphemeralReply(interaction, 'このチャンネルから観戦を開始してください。');
            return;
          }
          activityStore.issueLaunchIntent({
            discordUserId: interaction.user.id,
            guildId,
            channelId: interaction.channelId,
            raceId,
            interactionId: interaction.id,
          });
          try {
            await interaction.launchActivity();
            return;
          } catch (activityError) {
            // Preserve the proven browser path as an emergency fallback for old
            // clients and while Activity distribution is being configured.
            activityStore.cancelLaunchIntent(interaction.id);
            reportDiscordError(activityError);
          }
        }
        const issued = authStore.issueLoginTicket(interaction.user.id, raceId);
        const url = new URL('/auth/ticket', input.environment.PUBLIC_WEB_ORIGIN);
        url.hash = new URLSearchParams({ ticket: issued.ticket, raceId }).toString();
        const reply = createViewerLinkReply(url.toString());
        await safeEphemeralReply(interaction, reply.content, reply.components);
        return;
      }
      if (action === 'horse-info' && raceId !== undefined) {
        const horseInfo = renderHorseInfoMessage(readDiscordHorseInfo(input.database, raceId));
        await safeEphemeralEmbedReply(interaction, horseInfo.embeds);
        return;
      }
      if (action === 'balance') {
        const me = viewerStore.getMe(interaction.user.id);
        await safeEphemeralReply(interaction, `現在残高: ${me.balance} CP`);
        return;
      }
      if (action === 'bets' && raceId !== undefined) {
        const bets = viewerStore.getMyBets(raceId, interaction.user.id);
        await safeEphemeralReply(
          interaction,
          bets.length === 0
            ? 'このレースで購入済みの馬券はありません。'
            : bets
                .map(
                  (bet) =>
                    `${POOL_TYPE_DEFINITIONS[bet.poolType].label} ${horseSelectionEmojis(bet.selectionCode)} / ${bet.stake} CP / 状態: ${betStatusLabel(bet.status)}`,
                )
                .join('\n'),
        );
      }
    } catch (error) {
      reportDiscordError(error);
      try {
        await safeEphemeralReply(interaction, discordErrorMessage(error));
      } catch (replyError) {
        reportDiscordError(replyError);
      }
    }
  }
}

const BET_STATUS_LABELS: Readonly<Record<string, string>> = {
  open: '受付中',
  won: '的中',
  lost: '外れ',
  refunded: '返金済み',
};

export function betStatusLabel(status: string): string {
  return BET_STATUS_LABELS[status] ?? '状態不明';
}

export function discordErrorMessage(error: unknown): string {
  if (error instanceof DomainError) {
    switch (error.code) {
      case 'BETTING_CLOSED':
        return 'このレースの投票受付は終了しました。';
      case 'INSUFFICIENT_FUNDS':
        return '残高が不足しています。';
      case 'RACE_BET_LIMIT_EXCEEDED':
        return 'このレースの購入上限を超えています。';
      case 'INVALID_RACE_ENTRY':
        return 'レース情報が更新されました。最初からやり直してください。';
      case 'INVALID_MONEY':
        return '賭け金を確認してください。';
      case 'DUPLICATE_OPERATION':
        return 'この購入はすでに処理されています。';
      case 'INVALID_SELECTION':
        return '選択した馬券の内容を確認してください。';
      default:
        return '購入を処理できませんでした。時間をおいて再度お試しください。';
    }
  }
  if (error instanceof Error) {
    const messages: Readonly<Record<string, string>> = {
      'Current guild membership is required.': '現在のギルドメンバーだけが利用できます。',
      'Insufficient balance.': '残高が不足しています。',
      'Betting is closed.': 'このレースの投票受付は終了しました。',
      'Race version changed.': 'レース情報が更新されました。最初からやり直してください。',
      'Race version changed; restart the purchase flow.':
        'レース情報が更新されました。最初からやり直してください。',
      'Per-race stake limit exceeded.': 'このレースの購入上限を超えています。',
    };
    return messages[error.message] ?? '処理できませんでした。時間をおいて再度お試しください。';
  }
  return '処理できませんでした。時間をおいて再度お試しください。';
}

function reportDiscordError(error: unknown): void {
  process.emitWarning(error instanceof Error ? error : String(error));
}

export async function publishRaceMessage(input: {
  readonly client: Client;
  readonly database: SqliteDatabase;
  readonly environment: Environment;
  readonly clock: Clock;
  readonly raceId: string;
  readonly disablePreviousViewers?: boolean;
}): Promise<void> {
  const channelId = requireConfigured(
    input.environment.DISCORD_RACE_CHANNEL_ID,
    'DISCORD_RACE_CHANNEL_ID',
  );
  const channel = await input.client.channels.fetch(channelId);
  if (channel === null || !channel.isSendable()) {
    throw new Error('The #競馬 channel is not sendable.');
  }
  const viewerStore = new SqliteViewerStore(input.database);
  const detail = viewerStore.getRaceDetail(input.raceId);
  const now = input.clock.now();
  const canView = latestViewableRaceId(input.database, now) === input.raceId;
  const options = renderRaceMessageForDetail(viewerStore, detail, now, canView);
  const messages = new SqliteDiscordMessageStore(input.database, () => input.clock.now());
  const existing = messages.get('race', input.raceId);
  if (existing !== undefined) {
    try {
      const message = await channel.messages.fetch(existing.messageId);
      await message.edit(options);
      if (input.disablePreviousViewers === true && canView) {
        await disablePreviousRaceMessages({
          client: input.client,
          database: input.database,
          clock: input.clock,
          currentRaceId: input.raceId,
          viewerStore,
        });
      }
      return;
    } catch (error) {
      if (!isMissingDiscordMessage(error)) throw error;
      // A deleted fixed message is recreated below and its ID is replaced.
    }
  }
  const created = await channel.send({
    ...options,
    nonce: messageNonce(JSON.stringify(options)),
    enforceNonce: true,
  });
  messages.save({
    purpose: 'race',
    raceId: input.raceId,
    channelId,
    messageId: created.id,
  });
  if (input.disablePreviousViewers === true && canView) {
    await disablePreviousRaceMessages({
      client: input.client,
      database: input.database,
      clock: input.clock,
      currentRaceId: input.raceId,
      viewerStore,
    });
  }
}

function renderRaceMessageForDetail(
  viewerStore: SqliteViewerStore,
  detail: ReturnType<SqliteViewerStore['getRaceDetail']>,
  now: number,
  canView: boolean,
) {
  return renderRaceMessage({
    raceId: detail.id,
    version: detail.version,
    name: detail.name,
    raceDate: detail.raceDate,
    scheduledAt: timestamp(detail.scheduledAt),
    distanceM: detail.distanceM,
    surfaceLabel: detail.surface === 'turf' ? '芝' : 'ダート',
    horses: detail.entries.map((entry) => ({
      horseNumber: entry.horseNumber,
      name: entry.name,
      condition: entry.condition,
      currentWinOdds: entry.currentWinOdds,
    })),
    trifectaPoolTotal: money(BigInt(detail.trifectaPoolTotal)),
    carryover: money(BigInt(detail.carryover)),
    canBuy: detail.status === 'betting_open' && now < detail.bettingClosesAt,
    canView,
    finishOrder: resolveFinishOrder(viewerStore, detail.id, detail.status),
  });
}

async function disablePreviousRaceMessages(input: {
  readonly client: Client;
  readonly database: SqliteDatabase;
  readonly clock: Clock;
  readonly currentRaceId: string;
  readonly viewerStore: SqliteViewerStore;
}): Promise<void> {
  const messages = new SqliteDiscordMessageStore(input.database, () => input.clock.now());
  const failures: unknown[] = [];
  for (const reference of listDiscordRaceMessages(input.database)) {
    if (reference.raceId === input.currentRaceId) continue;
    try {
      const detail = input.viewerStore.getRaceDetail(reference.raceId);
      const channel = await input.client.channels.fetch(reference.channelId);
      if (channel === null || !channel.isTextBased() || !('messages' in channel)) continue;
      const message = await channel.messages.fetch(reference.messageId);
      await message.edit(
        renderRaceMessageForDetail(input.viewerStore, detail, input.clock.now(), false),
      );
    } catch (error) {
      if (isMissingDiscordMessage(error)) {
        messages.remove('race', reference.raceId);
        continue;
      }
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Past Discord race messages could not be disabled.');
  }
}

export function isMissingDiscordMessage(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { readonly code?: unknown; readonly status?: unknown };
  return candidate.code === 10_008 || candidate.status === 404;
}

function messageNonce(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 25);
}

export function createViewerLinkReply(url: string): {
  readonly content: string;
  readonly components: readonly [ActionRowBuilder<ButtonBuilder>];
} {
  const button = new ButtonBuilder()
    .setLabel('観戦画面を開く')
    .setStyle(ButtonStyle.Link)
    .setURL(url);
  return {
    content: 'このURLは一度だけ使え、5分で失効します。',
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
  };
}

async function safeEphemeralReply(
  interaction: Interaction,
  content: string,
  components: readonly ActionRowBuilder<ButtonBuilder>[] = [],
): Promise<void> {
  if (!interaction.isRepliable()) return;
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content, components: [] });
  } else {
    await interaction.reply({ content, components, flags: MessageFlags.Ephemeral });
  }
}

async function safeEphemeralEmbedReply(
  interaction: Interaction,
  embeds: readonly EmbedBuilder[],
): Promise<void> {
  if (!interaction.isRepliable()) return;
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds, components: [] });
  } else {
    await interaction.reply({ embeds, components: [], flags: MessageFlags.Ephemeral });
  }
}

function formatJst(epochMilliseconds: number): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(epochMilliseconds));
}

function requireConfigured(value: string | undefined, key: string): string {
  if (value === undefined) throw new Error(`${key} is not configured.`);
  return value;
}
