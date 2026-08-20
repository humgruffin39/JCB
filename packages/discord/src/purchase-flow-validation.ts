import {
  isPoolType,
  money,
  POOL_TYPE_DEFINITIONS,
  selectionCode,
  type PoolType,
} from '@jcb/domain';
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import type { PurchaseFlowDependencies } from './purchase-flow-context.js';
import type { PurchaseSession } from './types.js';

const PURCHASE_SESSION_STEPS = new Set([
  'pool',
  'pick-1',
  'pick-2',
  'pick-3',
  'amount',
  'previewing',
  'confirm',
  'processing',
  'completed',
]);

export function requireSession(
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
  return (
    session.discordUserId === discordUserId &&
    session.expiresAt > now &&
    PURCHASE_SESSION_STEPS.has(session.step)
  );
}

export function parsePoolType(value: string | undefined): PoolType {
  if (value === undefined || !isPoolType(value)) throw new Error('Pool type is missing.');
  return value;
}

export function poolDefinition(poolType: PoolType) {
  return POOL_TYPE_DEFINITIONS[poolType];
}

export function selectionFromSession(session: PurchaseSession, poolType: PoolType): string {
  const definition = poolDefinition(poolType);
  const selections = [session.payload.first, session.payload.second, session.payload.third].slice(
    0,
    definition.selectionSize,
  );
  if (selections.some((value) => !isHorseNumber(value))) {
    throw new Error(`${definition.label} selection is incomplete.`);
  }
  try {
    return selectionCode(poolType, (selections as string[]).map(Number));
  } catch {
    throw new Error('The same horse cannot fill two positions.');
  }
}

export function requireHorseNumber(value: string | undefined): string {
  if (!isHorseNumber(value)) throw new Error('Horse selection is missing.');
  return value;
}

export function requireStep(session: PurchaseSession, expected: string): void {
  if (session.step !== expected) throw new Error('Purchase session step is stale.');
}

export function finalPickStep(poolType: PoolType): 'pick-1' | 'pick-2' | 'pick-3' {
  return `pick-${String(poolDefinition(poolType).selectionSize)}` as 'pick-1' | 'pick-2' | 'pick-3';
}

function isHorseNumber(value: string | undefined): value is string {
  return value !== undefined && /^[1-8]$/.test(value);
}
