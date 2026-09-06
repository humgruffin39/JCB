import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { formatDateKeyForDisplay, JST_OFFSET_MILLISECONDS } from '@jcb/domain';
import type { Condition } from '@jcb/domain';
import { horseNumberEmoji } from './horse-number-emoji.js';
import type { DiscordRaceCard, DiscordRaceHorse } from './types.js';

const CONDITION_EMOJIS: Readonly<Record<Condition, string>> = {
  excellent: '<:excellent:1538152048292528208>',
  good: '<:good:1538151990893477938>',
  normal: '<:normal:1538151937269301348>',
  poor: '<:poor:1538151890137776158>',
  terrible: '<:terrible:1538151846844170260>',
};

const PLACE_LABELS: readonly string[] = [
  '１着',
  '２着',
  '３着',
  '４着',
  '５着',
  '６着',
  '７着',
  '８着',
];

export function renderRaceMessage(card: DiscordRaceCard): {
  readonly embeds: readonly [EmbedBuilder];
  readonly components: readonly [ActionRowBuilder<ButtonBuilder>, ActionRowBuilder<ButtonBuilder>];
} {
  if (card.horses.length !== 8) throw new Error('Race message requires exactly eight horses.');
  const lines = renderHorseLines(card.horses, card.finishOrder);
  const embed = new EmbedBuilder()
    .setTitle(card.name)
    .setDescription(
      [
        `${formatDateKeyForDisplay(card.raceDate)} ${new Date(card.scheduledAt + JST_OFFSET_MILLISECONDS).toISOString().slice(11, 16)} / ${String(card.distanceM)}m / ${card.surfaceLabel}`,
        '',
        ...lines,
        '',
        `最大賭け金: ${card.raceBetLimit.toLocaleString('ja-JP')} CP`,
        `キャリーオーバー: ${card.carryover.toString()} CP`,
      ].join('\n'),
    )
    .setColor(0x25d9ff);
  // Discord caps an action row at five buttons, so watching moves to its own row.
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`jcb:buy:${card.raceId}`)
      .setLabel('馬券を買う')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!card.canBuy),
    new ButtonBuilder()
      .setCustomId(`jcb:horse-info:${card.raceId}`)
      .setLabel('出走馬情報')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`jcb:initial-odds:${card.raceId}`)
      .setLabel('初期オッズ')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`jcb:bets:${card.raceId}`)
      .setLabel('購入済み馬券')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('jcb:balance').setLabel('残高').setStyle(ButtonStyle.Secondary),
  );
  const viewRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`jcb:view:${card.raceId}`)
      .setLabel('観戦する')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!card.canView),
  );
  return { embeds: [embed], components: [row, viewRow] };
}

/**
 * The odds the model published before a single ticket was sold: ability and
 * aptitude only, with neither the day's condition nor anyone's money in them.
 * Reading it against the condition on the card is the whole point, so it is kept
 * one tap away rather than crowding the card itself.
 */
export function renderInitialOddsMessage(card: Pick<DiscordRaceCard, 'horses'>): {
  readonly embeds: readonly [EmbedBuilder];
} {
  const lines = card.horses.map((horse) => formatOddsLine(horse, horse.baseWinOdds));
  return {
    embeds: [
      new EmbedBuilder().setDescription(['初期オッズ', '', ...lines].join('\n')).setColor(0x25d9ff),
    ],
  };
}

function renderHorseLines(
  horses: readonly DiscordRaceHorse[],
  finishOrder: readonly { readonly horseNumber: number; readonly position: number }[] | undefined,
): readonly string[] {
  if (finishOrder === undefined) {
    return horses.map((horse) => formatHorseLine(horse, undefined));
  }
  const positionByHorse = new Map<number, number>();
  for (const finish of finishOrder) {
    positionByHorse.set(finish.horseNumber, finish.position);
  }
  return [...horses]
    .sort((left, right) => {
      const leftPosition = positionByHorse.get(left.horseNumber) ?? Number.POSITIVE_INFINITY;
      const rightPosition = positionByHorse.get(right.horseNumber) ?? Number.POSITIVE_INFINITY;
      return leftPosition - rightPosition;
    })
    .map((horse) => formatHorseLine(horse, positionByHorse.get(horse.horseNumber)));
}

function formatHorseLine(horse: DiscordRaceHorse, position: number | undefined): string {
  const prefix =
    position === undefined ? '' : `**${PLACE_LABELS[position - 1] ?? String(position)}** `;
  return `${prefix}${formatOddsLine(horse, horse.currentWinOdds)}`;
}

function formatOddsLine(horse: DiscordRaceHorse, odds: string): string {
  const horseNumber = horseNumberEmoji(horse.horseNumber);
  return `${horseNumber} ${CONDITION_EMOJIS[horse.condition]} ${horse.name}  **${odds}倍**`;
}
