import type { ChatInputCommandInteraction, Guild } from 'discord.js';
import type { Logger } from '../logging/logger.js';
import type { BotState } from '../persistence/stateSchema.js';
import { retryOrThrow } from '../utilities/retry.js';
import { isPermanentDiscordError } from './errorClassification.js';

export const bestCommandName = 'best';
const bestCommandDescription = 'これまでの最高カウントを表示します';

export function formatBestCount(bestCount: string): string {
  return `最高記録：${bestCount}`;
}

export async function registerBestCommand(guild: Guild, logger: Logger): Promise<void> {
  const retryOptions = { isPermanent: isPermanentDiscordError };
  const commands = await retryOrThrow(() => guild.commands.fetch(), retryOptions);
  const existing = commands.find((command) => command.name === bestCommandName);
  const definition = {
    name: bestCommandName,
    description: bestCommandDescription,
    options: [],
  } as const;

  const command =
    existing === undefined
      ? await retryOrThrow(() => guild.commands.create(definition), retryOptions)
      : await retryOrThrow(() => guild.commands.edit(existing.id, definition), retryOptions);

  logger.info('best_command_registered', {
    guildId: guild.id,
    commandId: command.id,
  });
}

export async function replyWithBestCount(
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
    content: formatBestCount(state.bestCount),
    allowedMentions: {
      parse: [],
      users: [],
      roles: [],
      repliedUser: false,
    },
  });
  logger.info('best_command_used', {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
    bestCount: state.bestCount,
  });
}
