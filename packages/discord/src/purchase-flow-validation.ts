import { money, type PoolType } from '@jcb/domain';
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
  if (value !== 'win' && value !== 'trifecta') throw new Error('Pool type is missing.');
  return value;
}

export function selectionFromSession(session: PurchaseSession, poolType: PoolType): string {
  if (poolType === 'win') {
    if (!isHorseNumber(session.payload.first)) throw new Error('Win selection is missing.');
    return session.payload.first;
  }
  const { first, second, third } = session.payload;
  if (!isHorseNumber(first) || !isHorseNumber(second) || !isHorseNumber(third)) {
    throw new Error('Trifecta selection is incomplete.');
  }
  if (new Set([first, second, third]).size !== 3) {
    throw new Error('The same horse cannot fill two positions.');
  }
  return `${first}-${second}-${third}`;
}

export function requireHorseNumber(value: string | undefined): string {
  if (!isHorseNumber(value)) throw new Error('Horse selection is missing.');
  return value;
}

export function requireStep(session: PurchaseSession, expected: string): void {
  if (session.step !== expected) throw new Error('Purchase session step is stale.');
}

export function finalPickStep(poolType: PoolType): 'pick-1' | 'pick-3' {
  return poolType === 'win' ? 'pick-1' : 'pick-3';
}

function isHorseNumber(value: string | undefined): value is string {
  return value !== undefined && /^[1-8]$/.test(value);
}
