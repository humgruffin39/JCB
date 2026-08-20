import {
  MessageFlags,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { money, type PoolType } from '@jcb/domain';
import type { PurchaseFlowDependencies } from './purchase-flow-context.js';
import {
  horseChoice,
  poolChoice,
  purchasePreviewMessage,
  purchaseReceiptMessage,
  showAmountModal,
} from './purchase-flow-render.js';
import {
  finalPickStep,
  parsePoolType,
  parseStake,
  poolDefinition,
  requireHorseNumber,
  requireStep,
  selectionFromSession,
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
  const updated = dependencies.sessions.update(session.id, 'pool', 'pick-1', { poolType });
  try {
    await interaction.editReply(await horseChoice(updated, dependencies.gateway));
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
  const updated = dependencies.sessions.update(session.id, 'pool', 'pick-1', { poolType });
  try {
    await interaction.editReply(await horseChoice(updated, dependencies.gateway));
  } catch (error) {
    rollbackSession(dependencies, updated, 'pool', session.payload);
    throw error;
  }
}

export async function chooseHorse(
  interaction: StringSelectMenuInteraction,
  session: PurchaseSession,
  dependencies: PurchaseFlowDependencies,
): Promise<void> {
  if (!/^pick-[1-3]$/.test(session.step)) throw new Error('Purchase session step is stale.');
  const selected = requireHorseNumber(interaction.values[0]);
  const poolType = parsePoolType(session.payload.poolType);
  const definition = poolDefinition(poolType);
  const position = Number(session.step.slice('pick-'.length));
  const selectedAlready = [
    session.payload.first,
    session.payload.second,
    session.payload.third,
  ].filter((value): value is string => value !== undefined);
  if (selectedAlready.includes(selected)) {
    throw new Error('The same horse cannot fill two positions.');
  }
  const key = position === 1 ? 'first' : position === 2 ? 'second' : 'third';
  const payload = { ...session.payload, [key]: selected };
  if (position < definition.selectionSize) {
    await interaction.deferUpdate();
    const updated = dependencies.sessions.update(
      session.id,
      session.step,
      `pick-${String(position + 1)}`,
      payload,
    );
    try {
      await interaction.editReply(await horseChoice(updated, dependencies.gateway));
    } catch (error) {
      rollbackSession(dependencies, updated, session.step, session.payload);
      throw error;
    }
  } else {
    const updated = dependencies.sessions.update(session.id, session.step, 'amount', payload);
    try {
      await showAmountModal(interaction, updated);
    } catch (error) {
      rollbackSession(dependencies, updated, session.step, session.payload);
      throw error;
    }
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
  const pickStep = finalPickStep(poolType);
  if (parsedStake === undefined) {
    rollbackSession(dependencies, session, pickStep, payloadBeforeFinalPick(session, poolType));
    await interaction.editReply('賭け金は100CP以上の整数で入力してください。');
    return;
  }

  const selectionCode = selectionFromSession(session, poolType);
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
      selectionCode,
      stake: parsedStake,
    });
    confirming = dependencies.sessions.update(session.id, 'previewing', 'confirm', {
      ...session.payload,
      stake,
      selectionCode,
    });
    try {
      await interaction.editReply(
        purchasePreviewMessage({
          sessionId: confirming.id,
          poolType,
          selectionCode,
          stake,
          preview,
        }),
      );
    } catch (error) {
      rollbackSession(
        dependencies,
        confirming,
        pickStep,
        payloadBeforeFinalPick(session, poolType),
      );
      throw error;
    }
  } catch (error) {
    rollbackSession(dependencies, previewing, pickStep, payloadBeforeFinalPick(session, poolType));
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
  const selectionCode = session.payload.selectionCode;
  if (stake === undefined || selectionCode === undefined) {
    throw new Error('Purchase is incomplete.');
  }
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
      selectionCode,
      stake: money(BigInt(stake)),
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

function payloadBeforeFinalPick(
  session: PurchaseSession,
  poolType: PoolType,
): Readonly<Record<string, string>> {
  const { first, second } = session.payload;
  const definition = poolDefinition(poolType);
  return {
    poolType,
    ...(definition.selectionSize >= 2 && first !== undefined ? { first } : {}),
    ...(definition.selectionSize >= 3 && second !== undefined ? { second } : {}),
  };
}
