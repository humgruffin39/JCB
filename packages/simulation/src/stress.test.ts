import fc from 'fast-check';
import { identifier, type RaceEntry } from '@jcb/domain';
import { horseFixture } from '@jcb/test-support';
import { simulateOfficialRace, simulateOutcomeOnly, type SimulationInput } from './simulator.js';

const ability = fc.integer({ min: 0, max: 100 });
const horseStats = fc.record({
  speed: ability,
  start: ability,
  acceleration: ability,
  stamina: ability,
  lateKick: ability,
  conditionStability: ability,
  distancePreference: fc.integer({ min: -100, max: 100 }),
  surfacePreference: fc.integer({ min: -100, max: 100 }),
});

describe('simulation stress properties', () => {
  it('always produces a permutation of eight horses over varied seeds and inputs', () => {
    fc.assert(
      fc.property(
        fc.array(horseStats, { minLength: 8, maxLength: 8 }),
        fc.constantFrom(800, 1_200, 1_600, 2_400, 3_200, 5_000),
        fc.constantFrom<'turf' | 'dirt'>('turf', 'dirt'),
        fc.string({ minLength: 1, maxLength: 80 }),
        (stats, distanceM, surface, seed) => {
          const result = simulateOutcomeOnly(inputFor(stats, distanceM, surface), seed);
          expect([...result].sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('keeps official timelines finite and monotonic across multiple seeds', () => {
    const stats = Array.from({ length: 8 }, (_, index) => ({
      speed: 30 + index * 8,
      start: 100 - index * 7,
      acceleration: 20 + index * 9,
      stamina: index % 2 === 0 ? 0 : 100,
      lateKick: index % 3 === 0 ? 100 : 0,
      conditionStability: 50,
      distancePreference: -100 + index * 28,
      surfacePreference: 100 - index * 28,
    }));
    for (let index = 0; index < 40; index += 1) {
      const result = simulateOfficialRace(
        inputFor(stats, index % 2 === 0 ? 800 : 5_000, index % 3 === 0 ? 'dirt' : 'turf'),
        `stress-seed-${String(index)}`,
      );
      expect(result.finishOrder).toHaveLength(8);
      let timelineIsValid = true;
      for (let frameIndex = 0; frameIndex < result.timeline.length; frameIndex += 1) {
        for (let horseIndex = 0; horseIndex < 8; horseIndex += 1) {
          const horse = result.timeline[frameIndex]!.horses[horseIndex]!;
          timelineIsValid &&=
            Number.isFinite(horse.progress) &&
            Number.isFinite(horse.speed) &&
            horse.progress >= 0 &&
            horse.progress <= 1 &&
            (frameIndex === 0 ||
              horse.progress >= result.timeline[frameIndex - 1]!.horses[horseIndex]!.progress);
        }
      }
      expect(timelineIsValid).toBe(true);
    }
  }, 30_000);
});

function inputFor(
  stats: ReadonlyArray<{
    readonly speed: number;
    readonly start: number;
    readonly acceleration: number;
    readonly stamina: number;
    readonly lateKick: number;
    readonly conditionStability: number;
    readonly distancePreference: number;
    readonly surfacePreference: number;
  }>,
  distanceM: number,
  surface: 'turf' | 'dirt',
): SimulationInput {
  const entries: RaceEntry[] = stats.map((overrides, index) => ({
    horseNumber: index + 1,
    condition: index % 5 === 0 ? 'excellent' : index % 5 === 1 ? 'poor' : 'normal',
    tieBreaker: index / 10,
    horse: horseFixture(index + 1, {
      horseId: identifier(`stress-horse-${String(index + 1)}`),
      ...overrides,
    }),
  }));
  return {
    raceId: 'stress-race',
    raceVersion: 1,
    distanceM,
    surface,
    entries,
  };
}
