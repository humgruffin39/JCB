import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
} from 'discord.js';
import {
  isPoolType,
  POOL_TYPE_DEFINITIONS,
  POOL_TYPES,
  type Money,
  type PoolType,
} from '@jcb/domain';
import type {
  DiscordPurchaseGateway,
  PurchasePreview,
  PurchaseReceipt,
  PurchaseSession,
} from './types.js';
import { horseNumberEmoji } from './horse-number-emoji.js';
import {
  poolDefinition,
  positionsFromSession,
  selectionsFromSession,
} from './purchase-flow-validation.js';

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
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(continueButton),
    ],
  };
}

export async function formationChoice(session: PurchaseSession, gateway: DiscordPurchaseGateway) {
  const horses = await gateway.raceHorses(session.raceId);
  assertEightDistinctHorses(horses);
  const poolType = session.payload.poolType;
  if (poolType === undefined || !isPoolType(poolType)) throw new Error('Pool type is missing.');
  const definition = poolDefinition(poolType);
  const positions = positionsFromSession(session, poolType);
  // Every position is a multi-select, so one screen covers both a single ticket
  // and a formation. The point count is what turns the two into different money.
  const menus = positions.map((position, index) =>
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`jcb:pick:${session.id}:${String(index + 1)}`)
        .setPlaceholder(positionPrompt(definition, index + 1))
        .setMinValues(1)
        .setMaxValues(horses.length)
        .addOptions(
          horses.map((horse) => ({
            label: `${String(horse.number)}番 ${horse.name}`,
            value: String(horse.number),
            default: position.includes(horse.number),
          })),
        ),
    ),
  );
  const points = countPoints(session, poolType);
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`jcb:picks:${session.id}`)
      .setLabel(points === 0 ? '賭け金を入力' : `賭け金を入力（${String(points)}点）`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(points === 0),
  );
  return {
    content: formationSummary(session, poolType),
    embeds: [],
    components: [...menus, buttons],
  };
}

/**
 * The lines describing what is currently selected. They are reused by the
 * confirmation screen so the buyer checks the same shape twice.
 */
export function formationSummary(session: PurchaseSession, poolType: PoolType): string {
  const definition = poolDefinition(poolType);
  const positions = positionsFromSession(session, poolType);
  const points = countPoints(session, poolType);
  return [
    definition.selectionSize === 1 || points <= 1
      ? definition.label
      : `${definition.label} フォーメーション`,
    ...positions.map(
      (position, index) =>
        `${positionPrompt(definition, index + 1)}: ${
          position.length === 0 ? '未選択' : position.map(horseNumberEmoji).join(' ')
        }`,
    ),
    points === 0 ? '点数: —' : `点数: ${String(points)}点`,
  ].join('\n');
}

function countPoints(session: PurchaseSession, poolType: PoolType): number {
  try {
    return selectionsFromSession(session, poolType).length;
  } catch {
    return 0;
  }
}

function positionPrompt(definition: ReturnType<typeof poolDefinition>, position: number): string {
  if (definition.selectionSize === 1) return `${definition.label}の馬`;
  return definition.ordered ? `${String(position)}着` : `${String(position)}頭目`;
}

export async function showAmountModal(
  interaction: ButtonInteraction,
  session: PurchaseSession,
  raceBetLimit: Money,
  points: number,
): Promise<void> {
  // The cap lives in the placeholder rather than on its own line: it is only
  // needed at the moment of typing a number, and the flow is already several
  // screens long. A formation spends the same cap across every point, so the
  // number being typed is per point and the placeholder says so.
  const perPointLimit = raceBetLimit / BigInt(points);
  const input = new TextInputBuilder()
    .setCustomId('stake')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(12)
    .setPlaceholder(`100〜${perPointLimit.toLocaleString('ja-JP')} の整数`);
  const label = new LabelBuilder()
    .setLabel(points === 1 ? '賭け金（CP）' : `1点あたりの賭け金（CP） 全${String(points)}点`)
    .setTextInputComponent(input);
  const modal = new ModalBuilder()
    .setCustomId(`jcb:amount:${session.id}`)
    .setTitle('賭け金を入力')
    .addLabelComponents(label);
  await interaction.showModal(modal);
}

export function purchasePreviewMessage(input: {
  readonly sessionId: string;
  readonly summary: string;
  readonly poolType: PoolType;
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
  const points = input.preview.points;
  return {
    content: [
      input.summary,
      points === 1
        ? `賭け金: ${cp(input.preview.totalStake)}`
        : `賭け金: 1点 ${input.stake} CP / 合計 ${cp(input.preview.totalStake)}`,
      `的中時の見込み払戻: ${payoutRange(input.preview)}`,
      `購入後残高: ${cp(input.preview.balanceAfter)}`,
      '締切までの他ユーザーの投票で払戻見込みは変動します。',
    ].join('\n'),
    components: [rows],
  };
}

export function purchaseReceiptMessage(receipt: PurchaseReceipt) {
  return {
    content: [
      receipt.wasDuplicate
        ? 'この購入はすでに処理済みです。'
        : receipt.points === 1
          ? '馬券を購入しました。'
          : `${String(receipt.points)}点の馬券を購入しました。`,
      receipt.points === 1 ? `購入ID: ${receipt.betId}` : `合計: ${cp(receipt.totalStake)}`,
      `購入後残高: ${cp(receipt.balanceAfter)}`,
      '購入確定後の取消はできません。',
    ].join('\n'),
    components: [],
  };
}

function payoutRange(preview: PurchasePreview): string {
  const suffix = preview.includesCarryover ? '（キャリーオーバー込み）' : '';
  return preview.minimumPayout === preview.maximumPayout
    ? `${cp(preview.minimumPayout)}${suffix}`
    : `${preview.minimumPayout.toLocaleString('ja-JP')}〜${cp(preview.maximumPayout)}${suffix}`;
}

function cp(amount: Money): string {
  return `${amount.toLocaleString('ja-JP')} CP`;
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
