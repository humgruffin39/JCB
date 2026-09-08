import { identifier, money, type RaceEntry } from '@jcb/domain';
import { horseFixture } from '@jcb/test-support';
import type { SimulationInput } from '@jcb/simulation';
import { settleParimutuelPool } from '@jcb/economy';
import { currentOddsTenths } from './current-odds.js';
import { allocateSeedLiquidity, planAdaptiveSeedLiquidity } from './liquidity.js';
import { generateProbabilities, temperProbabilities, ODDS_TEMPERATURE } from './probabilities.js';

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
    const expected = {
      win: [8, 1],
      place: [8, 3],
      quinella: [28, 1],
      exacta: [56, 1],
      wide: [28, 3],
      trio: [56, 1],
      trifecta: [336, 1],
    } as const;
    for (const [poolType, [length, total]] of Object.entries(expected)) {
      const selections = result[poolType as keyof typeof expected];
      expect(selections).toHaveLength(length);
      expect(selections.every((selection) => selection.modelProbability > 0)).toBe(true);
      expect(
        selections.reduce((sum, selection) => sum + selection.modelProbability, 0),
      ).toBeCloseTo(total, 12);
    }
    for (const selection of result.win) {
      expect(selection.baseOdds).toBeCloseTo(1 / selection.modelProbability, 1);
    }
  });

  it('softens extreme probabilities while preserving their order', () => {
    const tempered = temperProbabilities([0.7, 0.2, 0.08, 0.02], 1.8);

    expect(tempered.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 14);
    expect(tempered[0]!).toBeLessThan(0.7);
    expect(tempered[3]!).toBeGreaterThan(0.02);
    expect(tempered[0]!).toBeGreaterThan(tempered[1]!);
    expect(tempered[1]!).toBeGreaterThan(tempered[2]!);
    expect(tempered[2]!).toBeGreaterThan(tempered[3]!);
    expect(() => temperProbabilities([0.5, 0.5], 0.9)).toThrow(
      'Odds temperature must be a finite number greater than or equal to 1.',
    );
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

describe('seed liquidity allocation', () => {
  it('funds every selection so each one still has a price', () => {
    const probabilities = [
      { selectionCode: 'a', modelProbability: 0.999_9, baseOdds: 1 },
      ...Array.from({ length: 335 }, (_, index) => ({
        selectionCode: `b${String(index)}`,
        modelProbability: 0,
        baseOdds: 0,
      })),
    ];

    const allocations = allocateSeedLiquidity(money(15_000n), probabilities);

    expect(allocations).toHaveLength(336);
    expect(allocations.every((allocation) => allocation.stake > 0n)).toBe(true);
    expect(allocations.reduce((sum, allocation) => sum + allocation.stake, 0n)).toBe(15_000n);
  });

  it('leaves the split alone when the pool cannot cover one unit each', () => {
    const probabilities = Array.from({ length: 336 }, (_, index) => ({
      selectionCode: `c${String(index)}`,
      modelProbability: index === 0 ? 1 : 0,
      baseOdds: index === 0 ? 1 : 0,
    }));

    const allocations = allocateSeedLiquidity(money(100n), probabilities);

    expect(allocations.reduce((sum, allocation) => sum + allocation.stake, 0n)).toBe(100n);
  });
});

describe('currentOddsTenths winning selection count', () => {
  it('divides the payable share by the number of selections the pool pays', () => {
    const single = currentOddsTenths(money(900n), money(100n), money(100n), money(0n));
    const triple = currentOddsTenths(money(900n), money(100n), money(100n), money(0n), 3);
    expect(single).toBe(100n);
    expect(triple).toBe(33n);
  });

  it('agrees with what a place pool actually pays out', () => {
    const seeds = [
      { selectionCode: '1', stake: money(300n) },
      { selectionCode: '2', stake: money(300n) },
      { selectionCode: '3', stake: money(300n) },
      { selectionCode: '4', stake: money(300n) },
    ];
    const stake = money(100n);
    const shownTenths = currentOddsTenths(money(1_200n), stake, money(300n), stake, 3);
    const settlement = settleParimutuelPool({
      poolAccountId: identifier('pool'),
      centralBankAccountId: identifier('bank'),
      winningSelections: ['1', '2', '3'],
      poolBalance: money(1_300n),
      tickets: [
        {
          id: 'ticket',
          accountId: identifier('user'),
          selectionCode: '1',
          stake,
          createdAt: 1,
        },
      ],
      seedPositions: seeds,
    });
    const payout = settlement.payouts.find((entry) => entry.recipientId === 'ticket')!.amount;
    const actualTenths = (payout * 10n) / stake;
    // The displayed figure floors to a tenth, so it may sit one tenth under.
    expect(actualTenths - shownTenths).toBeGreaterThanOrEqual(0n);
    expect(actualTenths - shownTenths).toBeLessThanOrEqual(1n);
  });
});

describe('seed pricing leaves no profitable selection', () => {
  it('keeps every stake on every horse at or below break even', () => {
    // Seed liquidity is the house position. If it is placed at a probability
    // below a horse's real chance, backing that horse pays more than it should
    // and the central bank funds the difference every race.
    const trueProbabilities = [0.3, 0.2, 0.15, 0.12, 0.09, 0.07, 0.05, 0.02];
    const simulationCount = 20_000;
    const selections = trueProbabilities.length;
    const modelled = temperProbabilities(
      trueProbabilities.map((probability) => {
        const smoothed =
          (probability * simulationCount + 0.5) / (simulationCount + 0.5 * selections);
        return 0.95 * smoothed + 0.05 * (1 / selections);
      }),
      ODDS_TEMPERATURE,
    );
    const seedTotal = money(10_000n);
    const seeds = allocateSeedLiquidity(
      seedTotal,
      modelled.map((probability, index) => ({
        selectionCode: String(index + 1),
        modelProbability: probability,
        baseOdds: 1 / probability,
      })),
    );

    for (const [index, probability] of trueProbabilities.entries()) {
      for (let stake = 100; stake <= 5_000; stake += 100) {
        const odds =
          Number(
            currentOddsTenths(
              seedTotal,
              money(BigInt(stake)),
              seeds[index]!.stake,
              money(BigInt(stake)),
            ),
          ) / 10;
        const expectedValue = probability * odds * stake - stake;
        expect(expectedValue).toBeLessThanOrEqual(0);
      }
    }
  });
});
