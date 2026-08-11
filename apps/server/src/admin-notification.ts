import { EmbedBuilder, type MessageCreateOptions } from 'discord.js';

export type AdminNoticeLevel = 'info' | 'success' | 'warning' | 'error';

export interface AdminNoticeField {
  readonly name: string;
  readonly value: string;
  readonly inline?: boolean;
}

export interface AdminNotice {
  readonly level: AdminNoticeLevel;
  readonly title: string;
  readonly description?: string;
  readonly fields?: readonly AdminNoticeField[];
}

export type AdminNoticeMessage = Omit<MessageCreateOptions, 'embeds'> & {
  readonly embeds: [EmbedBuilder];
};

const NOTICE_COLORS: Readonly<Record<AdminNoticeLevel, number>> = {
  info: 0x3b82f6,
  success: 0x22c55e,
  warning: 0xf59e0b,
  error: 0xef4444,
};

export function buildAdminNoticeMessage(
  notice: AdminNotice,
  occurredAt: number,
): AdminNoticeMessage {
  const embed = new EmbedBuilder()
    .setColor(NOTICE_COLORS[notice.level])
    .setTitle(limitText(notice.title, 256))
    .setFooter({ text: 'ジョサン中央銀行 管理通知' })
    .setTimestamp(occurredAt);

  if (notice.description !== undefined) {
    embed.setDescription(limitText(notice.description, 4_096));
  }
  if (notice.fields !== undefined && notice.fields.length > 0) {
    embed.addFields(
      notice.fields.map((field) => ({
        name: limitText(field.name, 256),
        value: limitText(field.value, 1_024),
        inline: field.inline ?? false,
      })),
    );
  }

  return {
    embeds: [embed],
    allowedMentions: { parse: [] },
  };
}

function limitText(value: string, maximumLength: number): string {
  const normalized = value
    .replaceAll('\r', '')
    .replaceAll('@', '＠')
    .replaceAll(/[\\`*_~|>()]/g, '\\$&')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
  return normalized.length <= maximumLength
    ? normalized
    : `${normalized.slice(0, maximumLength - 1)}…`;
}
