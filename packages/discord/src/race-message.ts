import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { formatDateKeyForDisplay } from '@jcb/domain';
import type { DiscordRaceCard } from './types.js';

export function renderRaceMessage(card: DiscordRaceCard): {
  readonly embeds: readonly [EmbedBuilder];
  readonly components: readonly [ActionRowBuilder<ButtonBuilder>];
} {
  if (card.horses.length !== 8) throw new Error('Race message requires exactly eight horses.');
  const embed = new EmbedBuilder()
    .setTitle(card.name)
    .setDescription(
      [
        `開催日: ${formatDateKeyForDisplay(card.raceDate)} / ${String(card.distanceM)}m / ${card.surfaceLabel}`,
        '',
        ...card.horses.map(
          (horse) =>
            `\`${String(horse.horseNumber).padStart(2, '0')}\` ${horse.name}  **${horse.currentWinOdds}倍**`,
        ),
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
  );
  return { embeds: [embed], components: [row] };
}
