import { DomainError } from './errors.js';
import type { HorseId } from './identifiers.js';

export const RUNNING_STYLES = ['front_runner', 'closer'] as const;
export const HORSE_STATUSES = ['active', 'resting', 'retired'] as const;
export const SURFACES = ['turf', 'dirt'] as const;
export const CONDITIONS = ['terrible', 'poor', 'normal', 'good', 'excellent'] as const;
export const HORSE_COAT_COLORS = ['black', 'chestnut', 'gray', 'cream'] as const;

export type RunningStyle = (typeof RUNNING_STYLES)[number];
export type HorseStatus = (typeof HORSE_STATUSES)[number];
export type Surface = (typeof SURFACES)[number];
export type Condition = (typeof CONDITIONS)[number];
export type HorseCoatColor = (typeof HORSE_COAT_COLORS)[number];

export interface HorseAbilities {
  readonly speed: number;
  readonly start: number;
  readonly acceleration: number;
  readonly stamina: number;
  readonly lateKick: number;
  readonly conditionStability: number;
  readonly distancePreference: number;
  readonly surfacePreference: number;
}

export interface HorseSnapshot extends HorseAbilities {
  readonly horseId: HorseId;
  readonly name: string;
  readonly runningStyle: RunningStyle;
}

export interface RaceEntry {
  readonly horseNumber: number;
  readonly condition: Condition;
  readonly tieBreaker: number;
  readonly horse: HorseSnapshot;
}

export const CONDITION_LEVELS: Readonly<Record<Condition, number>> = {
  terrible: -2,
  poor: -1,
  normal: 0,
  good: 1,
  excellent: 2,
};

export function validateAbility(value: number, name: keyof HorseAbilities): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new DomainError('INVALID_HORSE', `${name} must be an integer from 0 to 100.`);
  }
  return value;
}

export function validateHorseSnapshot(horse: HorseSnapshot): HorseSnapshot {
  if (horse.name.trim().length === 0 || horse.name.length > 80) {
    throw new DomainError('INVALID_HORSE', 'Horse name must contain 1 to 80 characters.');
  }
  for (const name of [
    'speed',
    'start',
    'acceleration',
    'stamina',
    'lateKick',
    'conditionStability',
  ] as const) {
    validateAbility(horse[name], name);
  }
  validatePreference(horse.distancePreference, 'distancePreference');
  validatePreference(horse.surfacePreference, 'surfacePreference');
  return horse;
}

export function validateRaceEntries(entries: readonly RaceEntry[]): readonly RaceEntry[] {
  if (entries.length !== 8) {
    throw new DomainError(
      'INVALID_RACE_ENTRY',
      'A locked race must contain exactly eight entries.',
    );
  }
  const horseNumbers = new Set<number>();
  const horseIds = new Set<string>();
  for (const entry of entries) {
    if (!Number.isInteger(entry.horseNumber) || entry.horseNumber < 1 || entry.horseNumber > 8) {
      throw new DomainError('INVALID_RACE_ENTRY', 'Horse numbers must be integers from 1 to 8.');
    }
    if (horseNumbers.has(entry.horseNumber) || horseIds.has(entry.horse.horseId)) {
      throw new DomainError(
        'INVALID_RACE_ENTRY',
        'Race horse numbers and horse IDs must be unique.',
      );
    }
    if (!Number.isFinite(entry.tieBreaker) || entry.tieBreaker < 0 || entry.tieBreaker >= 1) {
      throw new DomainError('INVALID_RACE_ENTRY', 'Tie breaker must be in [0, 1).');
    }
    validateHorseSnapshot(entry.horse);
    horseNumbers.add(entry.horseNumber);
    horseIds.add(entry.horse.horseId);
  }
  return entries;
}

export function conditionMultiplier(condition: Condition, conditionStability: number): number {
  validateAbility(conditionStability, 'conditionStability');
  const instability = 1 - conditionStability / 100;
  return 1 + 0.08 * (CONDITION_LEVELS[condition] / 2) * instability;
}

export function validatePreference(
  value: number,
  name: 'distancePreference' | 'surfacePreference',
): number {
  if (!Number.isInteger(value) || value < -100 || value > 100) {
    throw new DomainError('INVALID_HORSE', `${name} must be an integer from -100 to 100.`);
  }
  return value;
}

export function distancePreferenceScore(abilities: HorseAbilities, distanceM: number): number {
  if (!Number.isInteger(distanceM) || distanceM <= 0) {
    throw new DomainError('INVALID_RACE_ENTRY', 'Race distance must be a positive integer.');
  }
  const distanceAxis = Math.max(-1, Math.min(1, (distanceM - 1800) / 600));
  return (abilities.distancePreference / 100) * distanceAxis;
}

export function surfacePreferenceScore(abilities: HorseAbilities, surface: Surface): number {
  if (abilities.surfacePreference === 0) return 0;
  const surfaceAxis = surface === 'turf' ? -1 : 1;
  return (abilities.surfacePreference / 100) * surfaceAxis;
}
