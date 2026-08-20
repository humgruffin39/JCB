import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { isPoolType, POOL_TYPE_DEFINITIONS, POOL_TYPES, type PoolType } from '@jcb/domain';
import type {
  DiscordPurchaseGateway,
  PurchasePreview,
  PurchaseReceipt,
  PurchaseSession,
} from './types.js';
import { poolDefinition } from './purchase-flow-validation.js';

export function poolChoice(session: PurchaseSession) {
  const selectedPoolType = session.payload.poolType;
  const selectedDefinition =
    selectedPoolType !== undefined && isPoolType(selectedPoolType)
      ? POOL_TYPE_DEFINITIONS[selectedPoolType]
      : undefined;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`jcb:pool:${session.id}`)
    .setPlaceholder(selectedDefinition?.label ?? '券種を選択')
    .addOptions(
      POOL_TYPES.map((value) => ({
        label: POOL_TYPE_DEFINITIONS[value].label,
        description: POOL_TYPE_DEFINITIONS[value].description,
        value,
        default: value === selectedPoolType,
      })),
    );
  const continueButton = new ButtonBuilder()
    .setCustomId(`jcb:pool-confirm:${session.id}`)
    .setLabel('この券種で進む')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(selectedDefinition === undefined);
  return {
    content: null,
    embeds: [
      new EmbedBuilder()
        .setTitle('券種を選んでください。')
        .setDescription(selectedDefinition?.description ?? '券種を選択してください。'),
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(continueButton),
    ],
  };
}

export async function horseChoice(session: PurchaseSession, gateway: DiscordPurchaseGateway) {
  const horses = await gateway.raceHorses(session.raceId);
  assertEightDistinctHorses(horses);
  const position = Number(session.step.slice('pick-'.length));
  const poolType = session.payload.poolType;
  if (poolType === undefined || !isPoolType(poolType)) throw new Error('Pool type is missing.');
  const definition = poolDefinition(poolType);
  const selected = new Set(
    [session.payload.first, session.payload.second, session.payload.third].filter(
      (value): value is string => value !== undefined,
    ),
  );
  const orderedPrompt = definition.ordered
    ? `${String(position)}着候補`
    : `${String(position)}頭目`;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`jcb:pick:${session.id}`)
    .setPlaceholder(
      definition.selectionSize === 1
        ? `${definition.label}の馬を選択`
        : `${definition.label} ${orderedPrompt}を選択`,
    )
    .addOptions(
      horses
        .filter((horse) => !selected.has(String(horse.number)))
        .map((horse) => ({
          label: `${String(horse.number)}番 ${horse.name}`,
          value: String(horse.number),
        })),
    );
  return {
    content:
      definition.selectionSize === 1
        ? `${definition.label}の馬を選んでください。`
        : `${definition.label} ${orderedPrompt}を選んでください。`,
    embeds: [],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  };
}

export async function showAmountModal(
  interaction: StringSelectMenuInteraction,
  session: PurchaseSession,
): Promise<void> {
  const input = new TextInputBuilder()
    .setCustomId('stake')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(12)
    .setPlaceholder('100以上の整数');
  const label = new LabelBuilder().setLabel('賭け金（ルピー）').setTextInputComponent(input);
  const modal = new ModalBuilder()
    .setCustomId(`jcb:amount:${session.id}`)
    .setTitle('賭け金を入力')
    .addLabelComponents(label);
  await interaction.showModal(modal);
}

export function purchasePreviewMessage(input: {
  readonly sessionId: string;
  readonly poolType: PoolType;
  readonly selectionCode: string;
  readonly stake: string;
  readonly preview: PurchasePreview;
}) {
  const rows = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`jcb:confirm:${input.sessionId}`)
      .setLabel('購入を確定')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`jcb:back:${input.sessionId}`)
      .setLabel('選び直す')
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    content: [
      `券種: ${poolDefinition(input.poolType).label}`,
      `買い目: ${input.selectionCode}`,
      `賭け金: ${input.stake} R`,
      `購入後見込み払戻: ${input.preview.estimatedBasePayout.toString()} R`,
      `キャリーオーバー見込み: ${input.preview.estimatedCarryoverBonus.toString()} R`,
      `購入後残高: ${input.preview.balanceAfter.toString()} R`,
      '締切までの他ユーザーの投票で払戻見込みは変動します。',
    ].join('\n'),
    components: [rows],
  };
}

export function purchaseReceiptMessage(receipt: PurchaseReceipt) {
  return {
    content: [
      receipt.wasDuplicate ? 'この購入はすでに処理済みです。' : '馬券を購入しました。',
      `購入ID: ${receipt.betId}`,
      `購入後残高: ${receipt.balanceAfter.toString()} R`,
      '購入確定後の取消はできません。',
    ].join('\n'),
    components: [],
  };
}

function assertEightDistinctHorses(
  horses: readonly { readonly number: number; readonly name: string }[],
): void {
  const numbers = horses.map((horse) => horse.number);
  if (
    horses.length !== 8 ||
    new Set(numbers).size !== 8 ||
    numbers.some((number) => !Number.isInteger(number) || number < 1 || number > 8)
  ) {
    throw new Error('Race must contain eight horses.');
  }
}
