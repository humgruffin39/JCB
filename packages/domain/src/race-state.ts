import { DomainError } from './errors.js';

export const RACE_STATUSES = [
  'draft',
  'locked',
  'simulating',
  'betting_open',
  'betting_closed',
  'ready',
  'running',
  'finished',
  'settling',
  'settled',
  'cancelled',
  'failed',
] as const;

export type RaceStatus = (typeof RACE_STATUSES)[number];

const ALLOWED_TRANSITIONS: Readonly<Record<RaceStatus, readonly RaceStatus[]>> = {
  draft: ['locked', 'cancelled'],
  locked: ['simulating', 'draft', 'cancelled'],
  simulating: ['betting_open', 'failed'],
  betting_open: ['betting_closed', 'cancelled'],
  betting_closed: ['ready', 'cancelled'],
  ready: ['running', 'cancelled'],
  running: ['finished'],
  finished: ['settling'],
  settling: ['settled', 'failed'],
  settled: [],
  cancelled: [],
  failed: ['simulating', 'settling', 'cancelled'],
};

export function canTransitionRace(from: RaceStatus, to: RaceStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transitionRace(from: RaceStatus, to: RaceStatus): RaceStatus {
  if (!canTransitionRace(from, to)) {
    throw new DomainError(
      'INVALID_RACE_TRANSITION',
      `Race cannot transition from ${from} to ${to}.`,
    );
  }
  return to;
}

export function canMutateRaceEntries(status: RaceStatus): boolean {
  return status === 'draft' || status === 'locked';
}
