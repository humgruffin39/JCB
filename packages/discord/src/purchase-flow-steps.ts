import {
  MessageFlags,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { money } from '@jcb/domain';
import type { PurchaseFlowDependencies } from './purchase-flow-context.js';
import {
  formationChoice,
  formationSummary,
  poolChoice,
  purchasePreviewMessage,
  purchaseReceiptMessage,
  showAmountModal,
} from './purchase-flow-render.js';
import {
  formatPosition,
  parsePoolType,
  poolDefinition,
  parseStake,
  parsePosition,
  POSITION_KEYS,
  positionsFromSession,
  requireStep,
  selectionsFromSession,
} from './purchase-flow-validation.js';
import type { PurchaseReceipt, PurchaseSession } from './types.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export async function beginPurchase(
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
    expiresAt: (dependencies.clock.now() + FIFTEEN_MINUTES) as ReturnType<
      PurchaseFlowDependencies['clock']['now']
    >,
  });
  await interaction.editReply(poolChoice(session));
}

export async function choosePoolType(
  interaction: StringSelectMenuInteraction,
  session: PurchaseSession,
  poolTypeValue: string | undefined,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  requireStep(session, 'pool');
  const poolType = parsePoolType(poolTypeValue);
  await interaction.deferUpdate();
  const updated = dependencies.sessions.update(session.id, 'pool', 'pool', { poolType });
  try {
    await interaction.editReply(poolChoice(updated));
  } catch (error) {
    rollbackSession(dependencies, updated, 'pool', session.payload);
    throw error;
  }
}

export async function confirmPool(
  interaction: ButtonInteraction,
  session: PurchaseSession,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  requireStep(session, 'pool');
  const poolType = parsePoolType(session.payload.poolType);
  await interaction.deferUpdate();
  const updated = dependencies.sessions.update(session.id, 'pool', 'picks', { poolType });
  try {
    await interaction.editReply(await formationChoice(updated, dependencies.gateway));
  } catch (error) {
    rollbackSession(dependencies, updated, 'pool', session.payload);
    throw error;
  }
}

export async function chooseLegacyPool(
  interaction: ButtonInteraction,
  session: PurchaseSession,
  poolTypeValue: string | undefined,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  requireStep(session, 'pool');
  const poolType = parsePoolType(poolTypeValue);
  await interaction.deferUpdate();
  const updated = dependencies.sessions.update(session.id, 'pool', 'picks', { poolType });
  try {
    await interaction.editReply(await formationChoice(updated, dependencies.gateway));
  } catch (error) {
    rollbackSession(dependencies, updated, 'pool', session.payload);
    throw error;
  }
}

export async function choosePosition(
  interaction: StringSelectMenuInteraction,
  session: PurchaseSession,
  position: number,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  requireStep(session, 'picks');
  const poolType = parsePoolType(session.payload.poolType);
  const key = POSITION_KEYS[position - 1];
  if (key === undefined || position > poolDefinition(poolType).selectionSize) {
    throw new Error('Horse position is invalid.');
  }
  const chosen = parsePosition(interaction.values.join(','));
  if (chosen.length === 0) throw new Error('Horse selection is missing.');
  await interaction.deferUpdate();
  const payload = { ...session.payload, [key]: formatPosition(chosen) };
  const updated = dependencies.sessions.update(session.id, 'picks', 'picks', payload);
  try {
    await interaction.editReply(await formationChoice(updated, dependencies.gateway));
  } catch (error) {
    rollbackSession(dependencies, updated, 'picks', session.payload);
    throw error;
  }
}

/** Copies the first position over the rest, which is what a box is. */
export async function applyBox(
  interaction: ButtonInteraction,
  session: PurchaseSession,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  requireStep(session, 'picks');
  const poolType = parsePoolType(session.payload.poolType);
  const first = positionsFromSession(session, poolType)[0] ?? [];
  if (first.length === 0) throw new Error('Horse selection is missing.');
  await interaction.deferUpdate();
  const payload = { ...session.payload };
  for (const key of POSITION_KEYS.slice(0, poolDefinition(poolType).selectionSize)) {
    payload[key] = formatPosition(first);
  }
  const updated = dependencies.sessions.update(session.id, 'picks', 'picks', payload);
  try {
    await interaction.editReply(await formationChoice(updated, dependencies.gateway));
  } catch (error) {
    rollbackSession(dependencies, updated, 'picks', session.payload);
    throw error;
  }
}

export async function confirmSelection(
  interaction: ButtonInteraction,
  session: PurchaseSession,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  requireStep(session, 'picks');
  const poolType = parsePoolType(session.payload.poolType);
  const points = selectionsFromSession(session, poolType).length;
  const raceBetLimit = await dependencies.gateway.raceBetLimit(session.raceId);
  const updated = dependencies.sessions.update(session.id, 'picks', 'amount', session.payload);
  try {
    await showAmountModal(interaction, updated, raceBetLimit, points);
  } catch (error) {
    rollbackSession(dependencies, updated, 'picks', session.payload);
    throw error;
  }
}

export async function submitAmount(
  interaction: ModalSubmitInteraction,
  session: PurchaseSession,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  requireStep(session, 'amount');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rawStake = interaction.fields.getTextInputValue('stake').trim();
  const parsedStake = parseStake(rawStake);
  const poolType = parsePoolType(session.payload.poolType);
  if (parsedStake === undefined) {
    rollbackSession(dependencies, session, 'picks', session.payload);
    await interaction.editReply('賭け金は100CP以上の整数で入力してください。');
    return;
  }
  const selectionCodes = selectionsFromSession(session, poolType);
  const raceBetLimit = await dependencies.gateway.raceBetLimit(session.raceId);
  const totalStake = parsedStake * BigInt(selectionCodes.length);
  if (totalStake > raceBetLimit) {
    // Caught here so the buyer sees the arithmetic rather than a rejection after
    // the confirmation button. The cumulative per-race cap is still enforced by
    // the ledger when the purchase runs.
    rollbackSession(dependencies, session, 'picks', session.payload);
    await interaction.editReply(
      `${String(selectionCodes.length)}点 × ${parsedStake.toLocaleString('ja-JP')} CP = ` +
        `${totalStake.toLocaleString('ja-JP')} CP で、このレースの上限 ` +
        `${raceBetLimit.toLocaleString('ja-JP')} CP を超えています。`,
    );
    return;
  }

  const previewing = dependencies.sessions.update(
    session.id,
    'amount',
    'previewing',
    session.payload,
  );
  const stake = parsedStake.toString();
  let confirming: PurchaseSession;
  try {
    const preview = await dependencies.gateway.preview({
      discordUserId: interaction.user.id,
      raceId: session.raceId,
      poolType,
      selectionCodes,
      stakePerPoint: parsedStake,
    });
    confirming = dependencies.sessions.update(session.id, 'previewing', 'confirm', {
      ...session.payload,
      stake,
    });
    try {
      await interaction.editReply(
        purchasePreviewMessage({
          sessionId: confirming.id,
          summary: formationSummary(confirming, poolType),
          poolType,
          stake,
          preview,
        }),
      );
    } catch (error) {
      rollbackSession(dependencies, confirming, 'picks', session.payload);
      throw error;
    }
  } catch (error) {
    rollbackSession(dependencies, previewing, 'picks', session.payload);
    throw error;
  }
}

export async function confirmPurchase(
  interaction: ButtonInteraction,
  session: PurchaseSession,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  if (session.step !== 'confirm' && session.step !== 'completed') {
    throw new Error('Purchase session step is stale.');
  }
  await interaction.deferUpdate();
  if (session.step === 'confirm') {
    const currentVersion = await dependencies.gateway.currentRaceVersion(session.raceId);
    if (currentVersion !== session.raceVersion) throw new Error('Race version changed.');
  }
  const poolType = parsePoolType(session.payload.poolType);
  const stake = session.payload.stake;
  if (stake === undefined) throw new Error('Purchase is incomplete.');
  const selectionCodes = selectionsFromSession(session, poolType);
  const needsProcessingTransition = session.step === 'confirm';
  if (needsProcessingTransition) {
    dependencies.sessions.update(session.id, 'confirm', 'processing', session.payload);
  }
  let receipt: PurchaseReceipt;
  try {
    receipt = await dependencies.gateway.purchase({
      discordUserId: interaction.user.id,
      raceId: session.raceId,
      raceVersion: session.raceVersion,
      poolType,
      selectionCodes,
      stakePerPoint: money(BigInt(stake)),
      interactionId: interaction.id,
      operationId: session.id,
    });
    if (needsProcessingTransition) {
      dependencies.sessions.update(session.id, 'processing', 'completed', {
        ...session.payload,
        betId: receipt.betId,
      });
    }
  } catch (error) {
    if (needsProcessingTransition) {
      rollbackSession(dependencies, { ...session, step: 'processing' }, 'confirm', session.payload);
    }
    throw error;
  }
  await interaction.editReply(purchaseReceiptMessage(receipt));
}

export async function renderCurrentStep(
  interaction: ButtonInteraction,
  session: PurchaseSession,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  requireStep(session, 'confirm');
  await interaction.deferUpdate();
  const updated = dependencies.sessions.update(session.id, 'confirm', 'pool', {});
  await interaction.editReply(poolChoice(updated));
}

function rollbackSession(
  dependencies: PurchaseFlowDependencies,
  session: PurchaseSession,
  step: string,
  payload: Readonly<Record<string, string>>,
): void {
  try {
    dependencies.sessions.update(session.id, session.step, step, payload);
  } catch {
    // Preserve the user-facing operation error if the session changed concurrently.
  }
}
