import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { money, type Clock, type PoolType } from '@jcb/domain';
import type {
  DiscordPurchaseGateway,
  PurchaseReceipt,
  PurchaseSession,
  PurchaseSessionStore,
} from './types.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const PURCHASE_SESSION_ACTIONS = new Set(['pool', 'pick', 'amount', 'confirm', 'back']);

export interface PurchaseFlowDependencies {
  readonly sessions: PurchaseSessionStore;
  readonly gateway: DiscordPurchaseGateway;
  readonly clock: Clock;
}

export async function handlePurchaseInteraction(
  interaction: Interaction,
  dependencies: PurchaseFlowDependencies,
): Promise<boolean> {
  if (
    !interaction.isButton() &&
    !interaction.isStringSelectMenu() &&
    !interaction.isModalSubmit()
  ) {
    return false;
  }
  if (!interaction.customId.startsWith('jcb:')) return false;
  const parts = interaction.customId.split(':');
  const action = parts[1];
  if (action === 'buy' && interaction.isButton()) {
    await beginPurchase(interaction, parts[2] ?? '', dependencies);
    return true;
  }
  if (action === undefined || !PURCHASE_SESSION_ACTIONS.has(action)) return false;
  const sessionId = parts[2];
  if (sessionId === undefined) return false;
  const session = requireSession(interaction, sessionId, dependencies);
  if (action === 'pool' && interaction.isButton()) {
    await choosePool(interaction, session, parts[3], dependencies);
    return true;
  }
  if (action === 'pick' && interaction.isStringSelectMenu()) {
    await chooseHorse(interaction, session, dependencies);
    return true;
  }
  if (action === 'amount' && interaction.isModalSubmit()) {
    await submitAmount(interaction, session, dependencies);
    return true;
  }
  if (action === 'confirm' && interaction.isButton()) {
    await confirmPurchase(interaction, session, dependencies);
    return true;
  }
  if (action === 'back' && interaction.isButton()) {
    await renderCurrentStep(interaction, session, dependencies);
    return true;
  }
  return false;
}

async function beginPurchase(
  interaction: ButtonInteraction,
  raceId: string,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const raceVersion = await dependencies.gateway.currentRaceVersion(raceId);
  const session = dependencies.sessions.create({
    discordUserId: interaction.user.id,
    raceId,
    raceVersion,
    step: 'pool',
    payload: {},
    expiresAt: (dependencies.clock.now() + FIFTEEN_MINUTES) as ReturnType<Clock['now']>,
  });
  await interaction.editReply(poolChoice(session));
}

async function choosePool(
  interaction: ButtonInteraction,
  session: PurchaseSession,
  poolTypeValue: string | undefined,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  requireStep(session, 'pool');
  await interaction.deferUpdate();
  if (poolTypeValue !== 'win' && poolTypeValue !== 'trifecta') {
    throw new Error('Unknown pool type.');
  }
  const updated = dependencies.sessions.update(session.id, 'pool', 'pick-1', {
    poolType: poolTypeValue,
  });
  await interaction.editReply(await horseChoice(updated, dependencies));
}

async function chooseHorse(
  interaction: StringSelectMenuInteraction,
  session: PurchaseSession,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  if (!/^pick-[1-3]$/.test(session.step)) throw new Error('Purchase session step is stale.');
  const selected = interaction.values[0];
  if (selected === undefined) throw new Error('Horse selection is missing.');
  const poolType = parsePoolType(session.payload.poolType);
  if (poolType === 'win') {
    const updated = dependencies.sessions.update(session.id, session.step, 'amount', {
      ...session.payload,
      first: selected,
    });
    await showAmountModal(interaction, updated);
    return;
  }
  const position = Number(session.step.slice('pick-'.length));
  const selectedAlready = [session.payload.first, session.payload.second].filter(Boolean);
  if (selectedAlready.includes(selected))
    throw new Error('The same horse cannot fill two positions.');
  const key = position === 1 ? 'first' : position === 2 ? 'second' : 'third';
  const payload = { ...session.payload, [key]: selected };
  if (position < 3) {
    await interaction.deferUpdate();
    const updated = dependencies.sessions.update(
      session.id,
      session.step,
      `pick-${String(position + 1)}`,
      payload,
    );
    await interaction.editReply(await horseChoice(updated, dependencies));
  } else {
    const updated = dependencies.sessions.update(session.id, session.step, 'amount', payload);
    await showAmountModal(interaction, updated);
  }
}

async function showAmountModal(
  interaction: StringSelectMenuInteraction,
  session: PurchaseSession,
): Promise<void> {
  requireStep(session, 'amount');
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

async function submitAmount(
  interaction: ModalSubmitInteraction,
  session: PurchaseSession,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rawStake = interaction.fields.getTextInputValue('stake').trim();
  const parsedStake = parseStake(rawStake);
  if (parsedStake === undefined) {
    await interaction.editReply('賭け金は100ルピー以上の整数で入力してください。');
    return;
  }
  const poolType = parsePoolType(session.payload.poolType);
  const selectionCode = selectionFromSession(session, poolType);
  const stake = parsedStake;
  const preview = await dependencies.gateway.preview({
    discordUserId: interaction.user.id,
    raceId: session.raceId,
    poolType,
    selectionCode,
    stake,
  });
  const updated = dependencies.sessions.update(session.id, 'amount', 'confirm', {
    ...session.payload,
    stake: rawStake,
    selectionCode,
  });
  const rows = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`jcb:confirm:${updated.id}`)
      .setLabel('購入を確定')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`jcb:back:${updated.id}`)
      .setLabel('選び直す')
      .setStyle(ButtonStyle.Secondary),
  );
  await interaction.editReply({
    content: [
      `券種: ${poolType === 'win' ? '単勝' : '三連単'}`,
      `買い目: ${selectionCode}`,
      `賭け金: ${rawStake} R`,
      `購入後見込み払戻: ${preview.estimatedBasePayout.toString()} R`,
      `キャリーオーバー見込み: ${preview.estimatedCarryoverBonus.toString()} R`,
      `購入後残高: ${preview.balanceAfter.toString()} R`,
      '締切までの他ユーザーの投票で払戻見込みは変動します。',
    ].join('\n'),
    components: [rows],
  });
}

async function confirmPurchase(
  interaction: ButtonInteraction,
  session: PurchaseSession,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  requireStep(session, 'confirm');
  await interaction.deferUpdate();
  const currentVersion = await dependencies.gateway.currentRaceVersion(session.raceId);
  if (currentVersion !== session.raceVersion) throw new Error('Race version changed.');
  const poolType = parsePoolType(session.payload.poolType);
  const stake = session.payload.stake;
  const selectionCode = session.payload.selectionCode;
  if (stake === undefined || selectionCode === undefined)
    throw new Error('Purchase is incomplete.');
  dependencies.sessions.update(session.id, 'confirm', 'processing', session.payload);
  let receipt: PurchaseReceipt;
  try {
    receipt = await dependencies.gateway.purchase({
      discordUserId: interaction.user.id,
      raceId: session.raceId,
      raceVersion: session.raceVersion,
      poolType,
      selectionCode,
      stake: money(BigInt(stake)),
      interactionId: interaction.id,
      operationId: session.id,
    });
    dependencies.sessions.update(session.id, 'processing', 'completed', {
      ...session.payload,
      betId: receipt.betId,
    });
  } catch (error) {
    try {
      dependencies.sessions.update(session.id, 'processing', 'confirm', session.payload);
    } catch {
      // Preserve the original purchase error if the session changed concurrently.
    }
    throw error;
  }
  await interaction.editReply({
    content: [
      receipt.wasDuplicate ? 'この購入はすでに処理済みです。' : '馬券を購入しました。',
      `購入ID: ${receipt.betId}`,
      `購入後残高: ${receipt.balanceAfter.toString()} R`,
      '購入確定後の取消はできません。',
    ].join('\n'),
    components: [],
  });
}

async function renderCurrentStep(
  interaction: ButtonInteraction,
  session: PurchaseSession,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  requireStep(session, 'confirm');
  await interaction.deferUpdate();
  const updated = dependencies.sessions.update(session.id, 'confirm', 'pool', {});
  await interaction.editReply(poolChoice(updated));
}

function poolChoice(session: PurchaseSession) {
  return {
    content: '券種を選んでください。',
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`jcb:pool:${session.id}:win`)
          .setLabel('単勝')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`jcb:pool:${session.id}:trifecta`)
          .setLabel('三連単')
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

async function horseChoice(session: PurchaseSession, dependencies: PurchaseFlowDependencies) {
  const horses = await dependencies.gateway.raceHorses(session.raceId);
  if (horses.length !== 8) throw new Error('Race must contain eight horses.');
  const position = Number(session.step.slice('pick-'.length));
  const selected = new Set([session.payload.first, session.payload.second].filter(Boolean));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`jcb:pick:${session.id}`)
    .setPlaceholder(
      session.payload.poolType === 'win' ? '単勝の馬を選択' : `${String(position)}着候補を選択`,
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
      session.payload.poolType === 'win'
        ? '単勝の馬を選んでください。'
        : `三連単 ${String(position)}着候補を選んでください。`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  };
}

function requireSession(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  sessionId: string,
  dependencies: PurchaseFlowDependencies,
): PurchaseSession {
  const session = dependencies.sessions.get(sessionId);
  if (
    session === undefined ||
    !isPurchaseSessionValid(session, interaction.user.id, dependencies.clock.now())
  ) {
    throw new Error('Purchase session is stale or belongs to another user.');
  }
  return session;
}

export function parseStake(value: string): ReturnType<typeof money> | undefined {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return undefined;
  const parsed = BigInt(normalized);
  return parsed >= 100n ? money(parsed) : undefined;
}

export function isPurchaseSessionValid(
  session: PurchaseSession,
  discordUserId: string,
  now: number,
): boolean {
  return session.discordUserId === discordUserId && session.expiresAt > now;
}

function parsePoolType(value: string | undefined): PoolType {
  if (value !== 'win' && value !== 'trifecta') throw new Error('Pool type is missing.');
  return value;
}

function selectionFromSession(session: PurchaseSession, poolType: PoolType): string {
  if (poolType === 'win') {
    if (session.payload.first === undefined) throw new Error('Win selection is missing.');
    return session.payload.first;
  }
  const { first, second, third } = session.payload;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error('Trifecta selection is incomplete.');
  }
  return `${first}-${second}-${third}`;
}

function requireStep(session: PurchaseSession, expected: string): void {
  if (session.step !== expected) throw new Error('Purchase session step is stale.');
}
