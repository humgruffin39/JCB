import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { formatDateKeyForDisplay, JST_OFFSET_MILLISECONDS } from '@jcb/domain';
import type { Condition } from '@jcb/domain';
import type { DiscordRaceCard, DiscordRaceHorse } from './types.js';

const CONDITION_EMOJIS: Readonly<Record<Condition, string>> = {
  excellent: '<:excellent:1538152048292528208>',
  good: '<:good:1538151990893477938>',
  normal: '<:normal:1538151937269301348>',
  poor: '<:poor:1538151890137776158>',
  terrible: '<:terrible:1538151846844170260>',
};

const PLACE_LABELS: readonly string[] = ['1着', '2着', '3着', '4着', '5着', '6着', '7着', '8着'];

export function renderRaceMessage(card: DiscordRaceCard): {
  readonly embeds: readonly [EmbedBuilder];
  readonly components: readonly [ActionRowBuilder<ButtonBuilder>];
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
        `三連単プール: ${card.trifectaPoolTotal.toString()} R`,
        `キャリーオーバー: ${card.carryover.toString()} R`,
      ].join('\n'),
    )
    .setColor(0x25d9ff);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`jcb:buy:${card.raceId}`)
      .setLabel('馬券を買う')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!card.canBuy),
    new ButtonBuilder()
      .setCustomId(`jcb:bets:${card.raceId}`)
      .setLabel('購入済み馬券')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('jcb:balance').setLabel('残高').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`jcb:view:${card.raceId}`)
      .setLabel('観戦する')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!card.canView),
    new ButtonBuilder()
      .setCustomId(`jcb:horse-info:${card.raceId}`)
      .setLabel('出走馬情報')
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
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
  return `${prefix}\`${String(horse.horseNumber).padStart(2, '0')}\` ${CONDITION_EMOJIS[horse.condition]} ${horse.name}  **${horse.currentWinOdds}倍**`;
}
