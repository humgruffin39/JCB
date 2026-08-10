import { identifier, money, type RaceEntry } from '@jcb/domain';
import { horseFixture } from '@jcb/test-support';
import type { SimulationInput } from '@jcb/simulation';
import { currentOddsTenths } from './current-odds.js';
import { allocateSeedLiquidity, planAdaptiveSeedLiquidity } from './liquidity.js';
import { generateProbabilities } from './probabilities.js';

const entries: readonly RaceEntry[] = Array.from({ length: 8 }, (_, index) => ({
  horseNumber: index + 1,
  condition: 'normal',
  tieBreaker: index / 8,
  horse: horseFixture(index + 1, {
    horseId: identifier(`odds-horse-${index + 1}`),
    speed: index === 0 ? 90 : 45,
  }),
}));
const input: SimulationInput = {
  raceId: 'odds-race',
  raceVersion: 1,
  distanceM: 1200,
  surface: 'turf',
  entries,
};

describe('odds generation', () => {
  it('produces positive normalized probabilities without official result input', () => {
    const result = generateProbabilities(input, 'odds-only-seed', 250);
    expect(result.win).toHaveLength(8);
    expect(result.trifecta).toHaveLength(336);
    expect(result.win.every((selection) => selection.modelProbability > 0)).toBe(true);
    expect(result.trifecta.every((selection) => selection.modelProbability > 0)).toBe(true);
    expect(result.win.reduce((sum, selection) => sum + selection.modelProbability, 0)).toBeCloseTo(
      1,
      14,
    );
    expect(
      result.trifecta.reduce((sum, selection) => sum + selection.modelProbability, 0),
    ).toBeCloseTo(1, 14);
    for (const selection of result.win) {
      expect(selection.baseOdds).toBeCloseTo(1 / selection.modelProbability, 1);
    }
  });

  it('allocates every rupee of seed liquidity', () => {
    const result = generateProbabilities(input, 'allocation-seed', 100);
    const allocations = allocateSeedLiquidity(money(10_000n), result.win);
    expect(allocations.reduce((sum, position) => sum + position.stake, 0n)).toBe(10_000n);
  });

  it('lowers odds when the selection receives a user stake and raises them on other stakes', () => {
    const initial = currentOddsTenths(money(10_000n), money(0n), money(2_000n), money(0n));
    const popular = currentOddsTenths(money(10_000n), money(1_000n), money(2_000n), money(1_000n));
    const others = currentOddsTenths(money(10_000n), money(1_000n), money(2_000n), money(0n));
    expect(popular).toBeLessThan(initial);
    expect(others).toBeGreaterThan(initial);
  });

  it('reports median, automatic, and clamped seed liquidity after fourteen races', () => {
    const win = Array.from({ length: 14 }, (_, index) => money(BigInt(30_000 + index)));
    const trifecta = Array.from({ length: 14 }, (_, index) => money(BigInt(100_000 + index)));
    const plan = planAdaptiveSeedLiquidity('regular', win, trifecta, {
      winMinimum: money(5_000n),
      winMaximum: money(25_000n),
      trifectaMinimum: money(10_000n),
      trifectaMaximum: money(40_000n),
    });
    expect(plan.sampleCount).toBe(14);
    expect(plan.winMedian).toBe(30_006n);
    expect(plan.trifectaMedian).toBe(100_006n);
    expect(plan.automatic.trifecta).toBe(150_009n);
    expect(plan.applied).toEqual({
      win: money(25_000n),
      trifecta: money(40_000n),
    });
  });
});
