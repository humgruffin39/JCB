import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildEmoji,
  type Role,
  type TextChannel,
} from 'discord.js';
import type { Config } from '../config.js';
import { retryOrThrow } from '../utilities/retry.js';
import { isPermanentDiscordError } from './errorClassification.js';

export interface ValidatedDiscordResources {
  readonly guild: Guild;
  readonly channel: TextChannel;
  readonly penaltyRole: Role;
  readonly failureEmoji: GuildEmoji;
  readonly consecutiveWarningEmoji: GuildEmoji;
  readonly botUserId: string;
}

function requirePermission(hasPermission: boolean, permissionName: string): void {
  if (!hasPermission) {
    throw new Error(`Bot is missing required permission: ${permissionName}`);
  }
}

export async function validateDiscordStartup(
  client: Client<true>,
  config: Config,
): Promise<ValidatedDiscordResources> {
  const retryOptions = { isPermanent: isPermanentDiscordError };
  const guild = await retryOrThrow(() => client.guilds.fetch(config.guildId), retryOptions);
  const channel = await retryOrThrow(
    () => guild.channels.fetch(config.countChannelId),
    retryOptions,
  );
  if (channel === null || channel.type !== ChannelType.GuildText) {
    throw new Error('COUNT_CHANNEL_ID is not a guild text channel');
  }
  if (channel.guildId !== guild.id) {
    throw new Error('COUNT_CHANNEL_ID does not belong to GUILD_ID');
  }

  const [penaltyRole, failureEmoji, consecutiveWarningEmoji, botMember] = await Promise.all([
    retryOrThrow(() => guild.roles.fetch(config.penaltyRoleId), retryOptions),
    retryOrThrow(() => guild.emojis.fetch(config.failureEmojiId), retryOptions),
    retryOrThrow(() => guild.emojis.fetch(config.consecutiveWarningEmojiId), retryOptions),
    retryOrThrow(() => guild.members.fetchMe(), retryOptions),
  ]);
  if (penaltyRole === null) {
    throw new Error('PENALTY_ROLE_ID does not exist in the configured guild');
  }
  if (failureEmoji === null) {
    throw new Error('FAILURE_EMOJI_ID does not exist in the configured guild');
  }
  if (consecutiveWarningEmoji === null) {
    throw new Error('CONSECUTIVE_WARNING_EMOJI_ID does not exist in the configured guild');
  }

  const channelPermissions = channel.permissionsFor(botMember);
  requirePermission(channelPermissions.has(PermissionFlagsBits.ViewChannel), 'View Channel');
  requirePermission(
    channelPermissions.has(PermissionFlagsBits.ReadMessageHistory),
    'Read Message History',
  );
  requirePermission(channelPermissions.has(PermissionFlagsBits.SendMessages), 'Send Messages');
  requirePermission(channelPermissions.has(PermissionFlagsBits.ManageMessages), 'Manage Messages');
  requirePermission(botMember.permissions.has(PermissionFlagsBits.ManageRoles), 'Manage Roles');
  requirePermission(
    botMember.permissions.has(PermissionFlagsBits.ModerateMembers),
    'Moderate Members',
  );

  if (botMember.roles.highest.comparePositionTo(penaltyRole) <= 0) {
    throw new Error("The bot's highest role must be above the penalty role");
  }

  return {
    guild,
    channel,
    penaltyRole,
    failureEmoji,
    consecutiveWarningEmoji,
    botUserId: client.user.id,
  };
}
