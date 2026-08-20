import {
  SqliteDiscordMessageStore,
  SqliteRankingStore,
  type RankingSnapshot,
  type SqliteDatabase,
  type UserRanking,
} from '@jcb/database';
import type { Clock } from '@jcb/domain';
import { EmbedBuilder, type ChatInputCommandInteraction, type Client } from 'discord.js';
import { createHash } from 'node:crypto';

const MESSAGE_LIMIT = 2_000;
export const FORBES_COMMAND_NAME = 'forbes';
const PLACE_LABELS = ['１位', '２位', '３位', '４位', '５位'] as const;

export interface WealthRankingLeader {
  readonly discordUserId: string;
  readonly currentBalance: string;
}

export function readWealthRankingLeaders(database: SqliteDatabase): readonly WealthRankingLeader[] {
  return (
    database
      .prepare(
        `SELECT u.discord_user_id AS discordUserId, ab.amount AS currentBalance
         FROM users u
         JOIN accounts a ON a.account_type = 'user' AND a.owner_key = u.id
         JOIN account_balances ab ON ab.account_id = a.id
         WHERE EXISTS (
           SELECT 1
           FROM ledger_entries le
           JOIN ledger_transactions lt ON lt.id = le.transaction_id
           WHERE le.account_id = a.id AND lt.kind <> 'initial_grant'
         )
         ORDER BY ab.amount DESC, u.created_at, u.id
         LIMIT 5`,
      )
      .all() as { readonly discordUserId: string; readonly currentBalance: bigint }[]
  ).map((leader) => ({
    discordUserId: leader.discordUserId,
    currentBalance: leader.currentBalance.toString(),
  }));
}

export async function registerForbesCommand(input: {
  readonly client: Client;
  readonly guildId: string;
}): Promise<void> {
  const guild = await input.client.guilds.fetch(input.guildId);
  const commands = await guild.commands.fetch();
  const existing = commands.find((command) => command.name === FORBES_COMMAND_NAME);
  const definition = {
    name: FORBES_COMMAND_NAME,
    description: '現在の長者番付を表示します',
    options: [],
  };
  if (existing === undefined) await guild.commands.create(definition);
  else await guild.commands.edit(existing.id, definition);
}

export async function replyWithForbesRanking(input: {
  readonly interaction: ChatInputCommandInteraction;
  readonly database: SqliteDatabase;
}): Promise<void> {
  await input.interaction.reply({
    embeds: [renderWealthRankingEmbed(readWealthRankingLeaders(input.database))],
    allowedMentions: { parse: [] },
  });
}

export function renderWealthRankingEmbed(leaders: readonly WealthRankingLeader[]): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle('長者番付').setColor(0x25d9ff);
  const description = leaders
    .slice(0, 5)
    .map(
      (leader, index) =>
        `**${PLACE_LABELS[index]}** <@${leader.discordUserId}> ${BigInt(leader.currentBalance).toLocaleString('ja-JP')}CP`,
    )
    .join('\n');
  return description.length === 0 ? embed : embed.setDescription(description);
}

export async function publishRankingMessages(input: {
  readonly client: Client;
  readonly database: SqliteDatabase;
  readonly clock: Clock;
  readonly channelId: string;
}): Promise<void> {
  const channel = await input.client.channels.fetch(input.channelId);
  if (channel === null || !channel.isSendable() || !('messages' in channel)) {
    throw new Error('Ranking channel is not a text message channel.');
  }
  const snapshot = new SqliteRankingStore(input.database, () =>
    input.clock.now(),
  ).calculateAndSave();
  const messageStore = new SqliteDiscordMessageStore(input.database, () => input.clock.now());
  const contents = renderRankingMessages(snapshot);

  for (const [index, content] of contents.entries()) {
    const purpose = `ranking:${String(index + 1)}`;
    const existing = messageStore.get(purpose);
    if (existing !== undefined && existing.channelId === input.channelId) {
      try {
        const message = await channel.messages.fetch(existing.messageId);
        await message.edit({ content, allowedMentions: { parse: [] } });
        continue;
      } catch {
        // A missing fixed message is replaced below and its new ID is persisted.
      }
    }
    const created = await channel.send({
      content,
      allowedMentions: { parse: [] },
      nonce: createHash('sha256').update(`${purpose}:${content}`).digest('hex').slice(0, 25),
      enforceNonce: true,
    });
    messageStore.save({
      purpose,
      channelId: input.channelId,
      messageId: created.id,
    });
  }
}

export function renderRankingMessages(snapshot: RankingSnapshot): readonly string[] {
  const timestamp = `<t:${String(Math.floor(snapshot.calculatedAt / 1_000))}:R>`;
  const byBalance = [...snapshot.users].sort(
    (left, right) =>
      compareDecimal(right.currentBalance, left.currentBalance) ||
      left.displayName.localeCompare(right.displayName, 'ja'),
  );
  const byPayout = [...snapshot.users].sort(
    (left, right) =>
      compareDecimal(right.totalPayout, left.totalPayout) ||
      left.displayName.localeCompare(right.displayName, 'ja'),
  );
  const byMaximum = [...snapshot.users].sort(
    (left, right) =>
      compareDecimal(right.maximumPayout, left.maximumPayout) ||
      left.displayName.localeCompare(right.displayName, 'ja'),
  );

  return [
    rankingBlock(
      `## ジョサン中央銀行 固定ランキング 1/3\n現在残高 / 通算収支 • 更新 ${timestamp}`,
      byBalance,
      (user, place) =>
        `${place}. ${safeName(user)}  残高 ${rup(user.currentBalance)} / 収支 ${signedRup(user.lifetimeProfit)}`,
    ),
    rankingBlock(
      `## ジョサン中央銀行 固定ランキング 2/3\n通算払戻 / 単勝的中率 / 三連単的中 • 更新 ${timestamp}`,
      byPayout,
      (user, place) =>
        `${place}. ${safeName(user)}  払戻 ${rup(user.totalPayout)} / 単勝 ${formatRate(user.winHitRateBasisPoints)} / 三連単 ${String(user.trifectaWins)}回`,
    ),
    rankingBlock(
      `## ジョサン中央銀行 固定ランキング 3/3\n最高払戻 / 現在連敗 / 歴代最長連敗 • 更新 ${timestamp}`,
      byMaximum,
      (user, place) =>
        `${place}. ${safeName(user)}  最高 ${rup(user.maximumPayout)} / 連敗 ${String(user.currentLosingStreak)} / 最長 ${String(user.longestLosingStreak)}`,
      `\nキャリーオーバー歴代最高額: ${rup(snapshot.highestCarryover)}`,
    ),
  ];
}

function rankingBlock(
  heading: string,
  users: readonly UserRanking[],
  line: (user: UserRanking, place: number) => string,
  footer = '',
): string {
  const lines = users.slice(0, 20).map((user, index) => line(user, index + 1));
  const body = lines.length === 0 ? '登録ユーザーはまだいません。' : lines.join('\n');
  const message = `${heading}\n${body}${footer}`;
  if (message.length > MESSAGE_LIMIT) {
    throw new Error('Ranking message exceeds the Discord message limit.');
  }
  return message;
}

function safeName(user: UserRanking): string {
  return user.displayName
    .replaceAll('\\', '＼')
    .replaceAll('*', '＊')
    .replaceAll('_', '＿')
    .replaceAll('`', '｀')
    .replaceAll('@', '＠')
    .slice(0, 24);
}

function rup(value: string): string {
  return `${BigInt(value).toLocaleString('ja-JP')} CP`;
}

function signedRup(value: string): string {
  const amount = BigInt(value);
  return `${amount >= 0n ? '+' : ''}${amount.toLocaleString('ja-JP')} CP`;
}

function formatRate(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(1)}%`;
}

function compareDecimal(left: string, right: string): number {
  const first = BigInt(left);
  const second = BigInt(right);
  return first === second ? 0 : first > second ? 1 : -1;
}
