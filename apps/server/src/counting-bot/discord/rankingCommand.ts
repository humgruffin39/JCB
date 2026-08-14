import type { ChatInputCommandInteraction, Guild } from 'discord.js';
import type { Logger } from '../logging/logger.js';
import type { BotState } from '../persistence/stateSchema.js';
import { compareSnowflakes } from '../utilities/snowflake.js';
import { retryOrThrow } from '../utilities/retry.js';
import { isPermanentDiscordError } from './errorClassification.js';

export const rankingCommandName = 'loserboard';
const legacyRankingCommandName = 'ranking';
const rankingCommandDescription = '失敗数ランキングの上位3名を表示します';

export function formatFailureRanking(failureCounts: Readonly<Record<string, string>>): string {
  const ranking = Object.entries(failureCounts)
    .sort(([leftUserId, leftCount], [rightUserId, rightCount]) => {
      const countOrder = BigInt(rightCount) - BigInt(leftCount);
      if (countOrder < 0n) {
        return -1;
      }
      if (countOrder > 0n) {
        return 1;
      }
      return compareSnowflakes(leftUserId, rightUserId);
    })
    .slice(0, 3);

  return [
    '**失敗数ランキング**',
    ...[0, 1, 2].map((index) => {
      const entry = ranking[index];
      return entry === undefined
        ? `${index + 1}位：該当者なし`
        : `${index + 1}位：<@${entry[0]}>（${entry[1]}回）`;
    }),
  ].join('\n');
}

export async function registerRankingCommand(guild: Guild, logger: Logger): Promise<void> {
  const retryOptions = { isPermanent: isPermanentDiscordError };
  const commands = await retryOrThrow(() => guild.commands.fetch(), retryOptions);
  const current = commands.find((command) => command.name === rankingCommandName);
  const legacy = commands.find((command) => command.name === legacyRankingCommandName);
  const existing = current ?? legacy;
  const definition = {
    name: rankingCommandName,
    description: rankingCommandDescription,
    options: [],
  } as const;

  const command =
    existing === undefined
      ? await retryOrThrow(() => guild.commands.create(definition), retryOptions)
      : await retryOrThrow(() => guild.commands.edit(existing.id, definition), retryOptions);

  if (legacy !== undefined && legacy.id !== command.id) {
    await retryOrThrow(() => guild.commands.delete(legacy.id), retryOptions);
  }

  logger.info('ranking_command_registered', {
    guildId: guild.id,
    commandId: command.id,
    commandName: rankingCommandName,
  });
}

export async function replyWithFailureRanking(
  interaction: ChatInputCommandInteraction,
  state: BotState | null,
  logger: Logger,
): Promise<void> {
  if (state === null) {
    await interaction.reply({
      content: 'Botの準備中です。少し待ってからもう一度実行してください。',
      ephemeral: true,
    });
    return;
  }

  const content = formatFailureRanking(state.failureCounts);
  await interaction.reply({
    content,
    allowedMentions: {
      parse: [],
      users: [],
      roles: [],
      repliedUser: false,
    },
  });
  logger.info('ranking_command_used', {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
  });
}
