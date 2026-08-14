import type { ChatInputCommandInteraction, Guild } from 'discord.js';
import type { Logger } from '../logging/logger.js';
import type { BotState } from '../persistence/stateSchema.js';
import { compareSnowflakes } from '../utilities/snowflake.js';
import { retryOrThrow } from '../utilities/retry.js';
import { isPermanentDiscordError } from './errorClassification.js';

export const legendCommandName = 'leaderboard';
const legacyLegendCommandName = 'legend';
const legendCommandDescription = '正解カウント数の上位3名を表示します';

export function formatCountLegend(successfulCounts: Readonly<Record<string, string>>): string {
  const legend = Object.entries(successfulCounts)
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
    '**カウント数ランキング**',
    ...[0, 1, 2].map((index) => {
      const entry = legend[index];
      return entry === undefined
        ? `${index + 1}位：該当者なし`
        : `${index + 1}位：<@${entry[0]}>（${entry[1]}回）`;
    }),
  ].join('\n');
}

export async function registerLegendCommand(guild: Guild, logger: Logger): Promise<void> {
  const retryOptions = { isPermanent: isPermanentDiscordError };
  const commands = await retryOrThrow(() => guild.commands.fetch(), retryOptions);
  const current = commands.find((command) => command.name === legendCommandName);
  const legacy = commands.find((command) => command.name === legacyLegendCommandName);
  const existing = current ?? legacy;
  const definition = {
    name: legendCommandName,
    description: legendCommandDescription,
    options: [],
  } as const;

  const command =
    existing === undefined
      ? await retryOrThrow(() => guild.commands.create(definition), retryOptions)
      : await retryOrThrow(() => guild.commands.edit(existing.id, definition), retryOptions);

  if (legacy !== undefined && legacy.id !== command.id) {
    await retryOrThrow(() => guild.commands.delete(legacy.id), retryOptions);
  }

  logger.info('legend_command_registered', {
    guildId: guild.id,
    commandId: command.id,
    commandName: legendCommandName,
  });
}

export async function replyWithCountLegend(
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

  await interaction.reply({
    content: formatCountLegend(state.successfulCounts),
    allowedMentions: {
      parse: [],
      users: [],
      roles: [],
      repliedUser: false,
    },
  });
  logger.info('legend_command_used', {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
  });
}
