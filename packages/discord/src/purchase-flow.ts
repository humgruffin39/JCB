import type { Interaction } from 'discord.js';
import type { PurchaseFlowDependencies } from './purchase-flow-context.js';
import {
  beginPurchase,
  chooseHorse,
  chooseLegacyPool,
  choosePoolType,
  confirmPool,
  confirmPurchase,
  renderCurrentStep,
  submitAmount,
} from './purchase-flow-steps.js';
import { requireSession } from './purchase-flow-validation.js';

export type { PurchaseFlowDependencies } from './purchase-flow-context.js';
export { isPurchaseSessionValid, parseStake } from './purchase-flow-validation.js';

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
  const route = purchaseRoute(interaction.customId);
  if (route === undefined) return false;

  if (route.action === 'buy') {
    if (!interaction.isButton()) return false;
    await beginPurchase(interaction, route.raceId, dependencies);
    return true;
  }
  if (route.action === 'pool-select') {
    if (!interaction.isStringSelectMenu()) return false;
    const session = requireSession(interaction, route.sessionId, dependencies);
    await choosePoolType(interaction, session, interaction.values[0], dependencies);
    return true;
  }
  if (route.action === 'pool-confirm') {
    if (!interaction.isButton()) return false;
    const session = requireSession(interaction, route.sessionId, dependencies);
    await confirmPool(interaction, session, dependencies);
    return true;
  }
  if (route.action === 'pool-legacy') {
    if (!interaction.isButton()) return false;
    const session = requireSession(interaction, route.sessionId, dependencies);
    await chooseLegacyPool(interaction, session, route.poolType, dependencies);
    return true;
  }
  if (route.action === 'pick') {
    if (!interaction.isStringSelectMenu()) return false;
    const session = requireSession(interaction, route.sessionId, dependencies);
    await chooseHorse(interaction, session, dependencies);
    return true;
  }
  if (route.action === 'amount') {
    if (!interaction.isModalSubmit()) return false;
    const session = requireSession(interaction, route.sessionId, dependencies);
    await submitAmount(interaction, session, dependencies);
    return true;
  }
  if (route.action === 'confirm') {
    if (!interaction.isButton()) return false;
    const session = requireSession(interaction, route.sessionId, dependencies);
    await confirmPurchase(interaction, session, dependencies);
    return true;
  }
  if (route.action === 'back') {
    if (!interaction.isButton()) return false;
    const session = requireSession(interaction, route.sessionId, dependencies);
    await renderCurrentStep(interaction, session, dependencies);
    return true;
  }
  return false;
}

type PurchaseRoute =
  | { readonly action: 'buy'; readonly raceId: string }
  | { readonly action: 'pool-select'; readonly sessionId: string }
  | { readonly action: 'pool-confirm'; readonly sessionId: string }
  | { readonly action: 'pool-legacy'; readonly sessionId: string; readonly poolType: string }
  | {
      readonly action: 'pick' | 'amount' | 'confirm' | 'back';
      readonly sessionId: string;
    };

function purchaseRoute(customId: string): PurchaseRoute | undefined {
  const parts = customId.split(':');
  if (parts[0] !== 'jcb') return undefined;
  if (parts[1] === 'buy' && parts.length === 3 && hasValue(parts[2])) {
    return { action: 'buy', raceId: parts[2] };
  }
  if (parts[1] === 'pool' && parts.length === 3 && hasValue(parts[2])) {
    return { action: 'pool-select', sessionId: parts[2] };
  }
  if (parts[1] === 'pool-confirm' && parts.length === 3 && hasValue(parts[2])) {
    return { action: 'pool-confirm', sessionId: parts[2] };
  }
  if (parts[1] === 'pool' && parts.length === 4 && hasValue(parts[2]) && hasValue(parts[3])) {
    return { action: 'pool-legacy', sessionId: parts[2], poolType: parts[3] };
  }
  if (
    (parts[1] === 'pick' ||
      parts[1] === 'amount' ||
      parts[1] === 'confirm' ||
      parts[1] === 'back') &&
    parts.length === 3 &&
    hasValue(parts[2])
  ) {
    return { action: parts[1], sessionId: parts[2] };
  }
  return undefined;
}

function hasValue(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}
