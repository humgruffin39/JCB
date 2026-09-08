import {
  formationSelections,
  isPoolType,
  money,
  POOL_TYPE_DEFINITIONS,
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
  'picks',
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

export const MINIMUM_STAKE = 100n;

export function parseStake(value: string): ReturnType<typeof money> | undefined {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return undefined;
  const parsed = BigInt(normalized);
  return parsed >= MINIMUM_STAKE ? money(parsed) : undefined;
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

export const POSITION_KEYS = ['first', 'second', 'third'] as const;

/**
 * The horses picked for each place, in menu order. Positions the buyer has not
 * touched yet come back empty so the selection screen can render a partial
 * formation.
 */
export function positionsFromSession(
  session: PurchaseSession,
  poolType: PoolType,
): readonly (readonly number[])[] {
  return POSITION_KEYS.slice(0, poolDefinition(poolType).selectionSize).map((key) =>
    parsePosition(session.payload[key]),
  );
}

export function selectionsFromSession(
  session: PurchaseSession,
  poolType: PoolType,
): readonly string[] {
  const positions = positionsFromSession(session, poolType);
  if (positions.some((position) => position.length === 0)) {
    throw new Error(`${poolDefinition(poolType).label} selection is incomplete.`);
  }
  return formationSelections(poolType, positions);
}

export function parsePosition(value: string | undefined): readonly number[] {
  if (value === undefined || value === '') return [];
  const horseNumbers = value.split(',');
  if (!horseNumbers.every((horseNumber) => isHorseNumber(horseNumber))) {
    throw new Error('Horse selection is invalid.');
  }
  return [...new Set(horseNumbers.map(Number))].sort((left, right) => left - right);
}

export function formatPosition(horseNumbers: readonly number[]): string {
  return [...horseNumbers].sort((left, right) => left - right).join(',');
}

export function requirePositionIndex(value: string | undefined, poolType: PoolType): number {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 1 || index > poolDefinition(poolType).selectionSize) {
    throw new Error('Horse position is invalid.');
  }
  return index;
}

export function requireStep(session: PurchaseSession, expected: string): void {
  if (session.step !== expected) throw new Error('Purchase session step is stale.');
}

/**
 * The selection screen stays usable after the amount modal is dismissed. Discord
 * reports nothing when someone closes a modal, so a session parked at `amount`
 * has to keep accepting edits to the buy or the whole screen goes dead.
 */
export function requireSelectionStep(session: PurchaseSession): 'picks' | 'amount' {
  if (session.step !== 'picks' && session.step !== 'amount') {
    throw new Error('Purchase session step is stale.');
  }
  return session.step;
}

function isHorseNumber(value: string | undefined): value is string {
  return value !== undefined && /^[1-8]$/.test(value);
}
