import { money, type Money, type RaceKind } from '@jcb/domain';
import type { SelectionProbability } from './probabilities.js';

export interface SeedPositionAllocation {
  readonly selectionCode: string;
  readonly stake: Money;
}

export interface SeedLiquidity {
  readonly win: Money;
  readonly trifecta: Money;
}

export interface SeedLiquidityClamp {
  readonly winMinimum: Money;
  readonly winMaximum: Money;
  readonly trifectaMinimum: Money;
  readonly trifectaMaximum: Money;
}

export interface SeedLiquidityPlan {
  readonly sampleCount: number;
  readonly winMedian: Money | null;
  readonly trifectaMedian: Money | null;
  readonly automatic: SeedLiquidity;
  readonly applied: SeedLiquidity;
}

export const INITIAL_SEED_LIQUIDITY: Readonly<Record<RaceKind, SeedLiquidity>> = {
  regular: { win: money(10_000n), trifecta: money(15_000n) },
  midweek: { win: money(15_000n), trifecta: money(25_000n) },
  saturday_night: { win: money(25_000n), trifecta: money(40_000n) },
};

export function allocateSeedLiquidity(
  total: Money,
  probabilities: readonly SelectionProbability[],
): readonly SeedPositionAllocation[] {
  if (total < 0n || probabilities.length === 0) throw new Error('Invalid seed liquidity input.');
  const scale = 1_000_000_000_000n;
  const weights = probabilities.map((selection) => ({
    selectionCode: selection.selectionCode,
    weight: BigInt(Math.max(1, Math.round(selection.modelProbability * Number(scale)))),
  }));
  const totalWeight = weights.reduce((sum, selection) => sum + selection.weight, 0n);
  const floors = weights.map((selection) => {
    const numerator = total * selection.weight;
    return {
      selectionCode: selection.selectionCode,
      stake: numerator / totalWeight,
      remainder: numerator % totalWeight,
    };
  });
  let remaining = total - floors.reduce((sum, selection) => sum + selection.stake, 0n);
  floors.sort(
    (left, right) =>
      compareBigIntDescending(left.remainder, right.remainder) ||
      left.selectionCode.localeCompare(right.selectionCode),
  );
  for (const selection of floors) {
    if (remaining === 0n) break;
    selection.stake += 1n;
    remaining -= 1n;
  }
  fundEverySelection(floors, total);
  return floors
    .map((selection) => ({
      selectionCode: selection.selectionCode,
      stake: money(selection.stake),
    }))
    .sort((left, right) => left.selectionCode.localeCompare(right.selectionCode));
}

/**
 * Gives every selection at least one unit, taking it from the largest holdings.
 *
 * A selection the model never saw wins can round down to nothing, and a pool
 * position of zero has no odds to quote: the parimutuel divisor becomes zero,
 * which would take the odds snapshot — and with it the close of betting — down
 * with it. One unit keeps every selection priceable and the total unchanged.
 */
function fundEverySelection(
  allocations: { selectionCode: string; stake: bigint }[],
  total: bigint,
): void {
  if (total < BigInt(allocations.length)) return;
  const empty = allocations.filter((allocation) => allocation.stake === 0n);
  if (empty.length === 0) return;
  const donors = allocations
    .filter((allocation) => allocation.stake > 1n)
    .sort((left, right) => (left.stake === right.stake ? 0 : left.stake > right.stake ? -1 : 1));
  if (donors.length === 0) return;
  let donorIndex = 0;
  for (const allocation of empty) {
    let scanned = 0;
    while (scanned < donors.length && donors[donorIndex % donors.length]!.stake <= 1n) {
      donorIndex += 1;
      scanned += 1;
    }
    const donor = donors[donorIndex % donors.length]!;
    if (donor.stake <= 1n) return;
    donor.stake -= 1n;
    allocation.stake = 1n;
    donorIndex += 1;
  }
}

export function adaptiveSeedLiquidity(
  raceKind: RaceKind,
  lastFourteenWinTotals: readonly Money[],
  lastFourteenTrifectaTotals: readonly Money[],
  configuredClamp?: SeedLiquidityClamp,
): SeedLiquidity {
  return planAdaptiveSeedLiquidity(
    raceKind,
    lastFourteenWinTotals,
    lastFourteenTrifectaTotals,
    configuredClamp,
  ).applied;
}

export function planAdaptiveSeedLiquidity(
  raceKind: RaceKind,
  lastFourteenWinTotals: readonly Money[],
  lastFourteenTrifectaTotals: readonly Money[],
  configuredClamp?: SeedLiquidityClamp,
): SeedLiquidityPlan {
  if (lastFourteenWinTotals.length < 14 || lastFourteenTrifectaTotals.length < 14) {
    return {
      sampleCount: Math.min(lastFourteenWinTotals.length, lastFourteenTrifectaTotals.length),
      winMedian: null,
      trifectaMedian: null,
      automatic: INITIAL_SEED_LIQUIDITY[raceKind],
      applied: INITIAL_SEED_LIQUIDITY[raceKind],
    };
  }
  const isRegular = raceKind === 'regular';
  const clamp =
    configuredClamp ??
    (isRegular
      ? {
          winMinimum: money(5_000n),
          winMaximum: money(25_000n),
          trifectaMinimum: money(10_000n),
          trifectaMaximum: money(40_000n),
        }
      : {
          winMinimum: money(10_000n),
          winMaximum: money(50_000n),
          trifectaMinimum: money(20_000n),
          trifectaMaximum: money(80_000n),
        });
  const winMedian = median(lastFourteenWinTotals);
  const trifectaMedian = median(lastFourteenTrifectaTotals);
  const automatic = {
    win: winMedian,
    trifecta: money((trifectaMedian * 3n) / 2n),
  };
  return {
    sampleCount: 14,
    winMedian,
    trifectaMedian,
    automatic,
    applied: {
      win: clampMoney(automatic.win, clamp.winMinimum, clamp.winMaximum),
      trifecta: clampMoney(automatic.trifecta, clamp.trifectaMinimum, clamp.trifectaMaximum),
    },
  };
}

function median(values: readonly Money[]): Money {
  const ordered = [...values].sort(compareBigIntAscending);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle]!;
  return money((ordered[middle - 1]! + ordered[middle]!) / 2n);
}

function clampMoney(value: Money, minimum: Money, maximum: Money): Money {
  return money(value < minimum ? minimum : value > maximum ? maximum : value);
}

function compareBigIntAscending(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareBigIntDescending(left: bigint, right: bigint): number {
  return -compareBigIntAscending(left, right);
}
