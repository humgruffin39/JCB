import {
  timestamp,
  type Condition,
  type HorseCoatColor,
  type HorseSnapshot,
  type RaceKind,
  type RaceStatus,
  type Timestamp,
} from '@jcb/domain';
import type { AccountId } from '@jcb/domain';

export interface HorseWrite extends Omit<HorseSnapshot, 'horseId'> {
  readonly status: 'active' | 'resting' | 'retired';
  readonly coatColor?: HorseCoatColor | undefined;
}

export interface HorseRecord extends Omit<HorseWrite, 'coatColor'> {
  readonly id: string;
  readonly coatColor: HorseCoatColor;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly retiredAt?: Timestamp;
}

export interface RaceEntryDraftInput {
  readonly horseId: string;
  readonly horseNumber: number;
}

export interface RaceDraftInput {
  readonly raceDate: string;
  readonly name: string;
  readonly kind?: RaceKind;
  readonly distanceM: number;
  readonly surface: 'turf' | 'dirt';
  readonly scheduledAt: Timestamp;
  readonly bettingOpensAt: Timestamp;
  readonly bettingClosesAt: Timestamp;
  readonly viewerOpensAt: Timestamp;
  readonly entries: readonly RaceEntryDraftInput[];
}

export type RaceDraftPatch = Partial<RaceDraftInput>;

export interface RaceRecord {
  readonly id: string;
  readonly raceDate: string;
  readonly name: string;
  readonly kind: RaceKind;
  readonly status: RaceStatus;
  readonly version: number;
  readonly distanceM: number;
  readonly surface: 'turf' | 'dirt';
  readonly scheduledAt: Timestamp;
  readonly bettingOpensAt: Timestamp;
  readonly bettingClosesAt: Timestamp;
  readonly viewerOpensAt: Timestamp;
  readonly inputHash?: string;
}

export interface RaceLockSettings {
  readonly conditionProbabilities: Readonly<Record<Condition, number>>;
  readonly simulationNoiseStandardDeviation: number;
  readonly fatigueMaximum: number;
  readonly seedLiquidityClamp?: {
    readonly regular: SeedClamp;
    readonly special: SeedClamp;
  };
  readonly raceBetLimits?: Readonly<Record<RaceKind, number>>;
}

interface SeedClamp {
  readonly winMinimum: number;
  readonly winMaximum: number;
  readonly trifectaMinimum: number;
  readonly trifectaMaximum: number;
}

export interface RegisteredUser {
  readonly id: string;
  readonly accountId: AccountId;
  readonly wasCreated: boolean;
}

export interface HorseRow {
  readonly id: string;
  readonly name: string;
  readonly status: HorseWrite['status'];
  readonly runningStyle: HorseWrite['runningStyle'];
  readonly coatColor: HorseCoatColor;
  readonly speed: bigint;
  readonly start: bigint;
  readonly acceleration: bigint;
  readonly stamina: bigint;
  readonly lateKick: bigint;
  readonly conditionStability: bigint;
  readonly distancePreference: bigint;
  readonly surfacePreference: bigint;
  readonly createdAt: bigint;
  readonly updatedAt: bigint;
  readonly retiredAt: bigint | null;
}

export interface RaceRow {
  readonly id: string;
  readonly raceDate: string;
  readonly name: string;
  readonly kind: RaceKind;
  readonly status: RaceStatus;
  readonly version: bigint;
  readonly distanceM: bigint;
  readonly surface: RaceRecord['surface'];
  readonly scheduledAt: bigint;
  readonly bettingOpensAt: bigint;
  readonly bettingClosesAt: bigint;
  readonly viewerOpensAt: bigint;
  readonly inputHash: string | null;
}

export function mapHorse(row: HorseRow): HorseRecord {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    runningStyle: row.runningStyle,
    coatColor: row.coatColor,
    speed: Number(row.speed),
    start: Number(row.start),
    acceleration: Number(row.acceleration),
    stamina: Number(row.stamina),
    lateKick: Number(row.lateKick),
    conditionStability: Number(row.conditionStability),
    distancePreference: Number(row.distancePreference),
    surfacePreference: Number(row.surfacePreference),
    createdAt: timestamp(Number(row.createdAt)),
    updatedAt: timestamp(Number(row.updatedAt)),
    ...(row.retiredAt === null ? {} : { retiredAt: timestamp(Number(row.retiredAt)) }),
  };
}

export function mapRace(row: RaceRow): RaceRecord {
  return {
    id: row.id,
    raceDate: row.raceDate,
    name: row.name,
    kind: row.kind,
    status: row.status,
    version: Number(row.version),
    distanceM: Number(row.distanceM),
    surface: row.surface,
    scheduledAt: timestamp(Number(row.scheduledAt)),
    bettingOpensAt: timestamp(Number(row.bettingOpensAt)),
    bettingClosesAt: timestamp(Number(row.bettingClosesAt)),
    viewerOpensAt: timestamp(Number(row.viewerOpensAt)),
    ...(row.inputHash === null ? {} : { inputHash: row.inputHash }),
  };
}

export function legacyAptitudes(
  distancePreference: number,
  surfacePreference: number,
): {
  readonly sprint: number;
  readonly mile: number;
  readonly middle: number;
  readonly long: number;
  readonly turf: number;
  readonly dirt: number;
} {
  const ability = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
  return {
    sprint: ability(50 - distancePreference / 2),
    mile: ability(50 - distancePreference / 6),
    middle: ability(50 + distancePreference / 6),
    long: ability(50 + distancePreference / 2),
    turf: ability(50 - surfacePreference / 2),
    dirt: ability(50 + surfacePreference / 2),
  };
}

export const DEFAULT_RACE_LOCK_SETTINGS: RaceLockSettings = {
  conditionProbabilities: {
    terrible: 0.1,
    poor: 0.2,
    normal: 0.4,
    good: 0.2,
    excellent: 0.1,
  },
  simulationNoiseStandardDeviation: 0.022,
  fatigueMaximum: 0.12,
};

export const DEFAULT_SEED_LIQUIDITY_CLAMP = {
  regular: {
    winMinimum: 5_000,
    winMaximum: 25_000,
    trifectaMinimum: 10_000,
    trifectaMaximum: 40_000,
  },
  special: {
    winMinimum: 10_000,
    winMaximum: 50_000,
    trifectaMinimum: 20_000,
    trifectaMaximum: 80_000,
  },
} as const;

export const DEFAULT_RACE_BET_LIMITS: Readonly<Record<RaceKind, number>> = {
  regular: 5_000,
  midweek: 10_000,
  saturday_night: 20_000,
};

export function selectCondition(
  randomUnit: number,
  probabilities: Readonly<Record<Condition, number>>,
): Condition {
  if (randomUnit < 0 || randomUnit >= 1) throw new Error('Random unit must be in [0, 1).');
  let cumulative = 0;
  for (const condition of ['terrible', 'poor', 'normal', 'good'] as const) {
    cumulative += probabilities[condition];
    if (randomUnit < cumulative) return condition;
  }
  return 'excellent';
}
