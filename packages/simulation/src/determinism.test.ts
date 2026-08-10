import { identifier, type RaceEntry } from '@jcb/domain';
import { horseFixture } from '@jcb/test-support';
import { decodeTimeline, encodeTimeline } from './timeline-codec.js';
import { simulateOfficialRace, simulateOutcomeOnly, type SimulationInput } from './simulator.js';

const entries: readonly RaceEntry[] = Array.from({ length: 8 }, (_, index) => ({
  horseNumber: index + 1,
  condition: index === 0 ? 'excellent' : 'normal',
  tieBreaker: index / 8,
  horse: horseFixture(index + 1, {
    horseId: identifier(`horse-${index + 1}`),
    speed: 50 + index,
  }),
}));

const input: SimulationInput = {
  raceId: 'race-1',
  raceVersion: 1,
  distanceM: 1200,
  surface: 'turf',
  entries,
};

describe('official simulation determinism', () => {
  it('returns byte-equivalent output for the same input, seed, and version', () => {
    const first = simulateOfficialRace(input, 'official-seed');
    const second = simulateOfficialRace(input, 'official-seed');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.resultHash).toBe(second.resultHash);
  });

  it('finishes all eight horses with consistent positions and times', () => {
    const result = simulateOfficialRace(input, 'finish-seed');
    expect(result.finishOrder).toHaveLength(8);
    expect(result.finishOrder.map((finish) => finish.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.finishOrder.every((finish) => Number.isFinite(finish.finishTimeMs))).toBe(true);
    expect(result.timeline.every((frame) => frame.horses.length === 8)).toBe(true);
  });

  it('produces monotonic progress at 10Hz and round-trips the timeline codec', () => {
    const result = simulateOfficialRace(input, 'timeline-seed');
    for (let index = 1; index < result.timeline.length; index += 1) {
      expect(result.timeline[index]!.timeMs - result.timeline[index - 1]!.timeMs).toBe(100);
      for (let horse = 0; horse < 8; horse += 1) {
        expect(result.timeline[index]!.horses[horse]!.progress).toBeGreaterThanOrEqual(
          result.timeline[index - 1]!.horses[horse]!.progress,
        );
      }
    }
    expect(decodeTimeline(encodeTimeline(result.timeline))).toEqual(result.timeline);
  });

  it('does not reduce expected wins when speed is increased', () => {
    const wins = (speed: number): number =>
      Array.from({ length: 120 }, (_, index) =>
        simulateOutcomeOnly(
          withHorseOne({ speed, conditionStability: 100 }),
          `speed-${String(index)}`,
        )[0] === 1
          ? 1
          : 0,
      ).reduce<number>((sum, value) => sum + value, 0);
    expect(wins(80)).toBeGreaterThanOrEqual(wins(35));
  });

  it('applies start and acceleration independently during the opening phase', () => {
    const seed = 'opening-ability';
    const baseline = simulateOfficialRace(withHorseOne({ start: 20, acceleration: 20 }), seed);
    const betterStart = simulateOfficialRace(withHorseOne({ start: 90, acceleration: 20 }), seed);
    const betterAcceleration = simulateOfficialRace(
      withHorseOne({ start: 20, acceleration: 90 }),
      seed,
    );
    const atOneSecond = (result: typeof baseline) =>
      result.timeline.find((frame) => frame.timeMs === 1_000)!.horses[0]!.progress;
    expect(atOneSecond(betterStart)).toBeGreaterThan(atOneSecond(baseline));
    expect(atOneSecond(betterAcceleration)).toBeGreaterThan(atOneSecond(baseline));
  });

  it('makes low stamina slower over long distance', () => {
    const low = simulateOfficialRace(
      withHorseOne({ stamina: 0, distancePreference: 100 }, 2_400),
      'stamina-long',
    );
    const high = simulateOfficialRace(
      withHorseOne({ stamina: 100, distancePreference: 100 }, 2_400),
      'stamina-long',
    );
    const finishTime = (result: typeof low) =>
      result.finishOrder.find((finish) => finish.horseNumber === 1)!.finishTimeMs;
    expect(finishTime(high)).toBeLessThan(finishTime(low));
  });

  it('does not apply late kick before the closing phase and emits only finite values', () => {
    const low = simulateOfficialRace(withHorseOne({ lateKick: 0 }), 'late-kick');
    const high = simulateOfficialRace(withHorseOne({ lateKick: 100 }), 'late-kick');
    for (let index = 0; index < low.timeline.length; index += 1) {
      const lowHorse = low.timeline[index]!.horses[0]!;
      if (lowHorse.progress > 0.5) break;
      expect(high.timeline[index]!.horses[0]!.progress).toBe(lowHorse.progress);
      expect(high.timeline[index]!.horses[0]!.speed).toBe(lowHorse.speed);
    }
    expect(
      high.timeline.every((frame) =>
        frame.horses.every(
          (horse) =>
            Number.isFinite(horse.progress) &&
            Number.isFinite(horse.speed) &&
            Number.isFinite(horse.lateralOffset),
        ),
      ),
    ).toBe(true);
  });
});

function withHorseOne(
  overrides: Partial<(typeof entries)[number]['horse']>,
  distanceM = 1_200,
): SimulationInput {
  return {
    ...input,
    distanceM,
    entries: entries.map((entry) =>
      entry.horseNumber === 1 ? { ...entry, horse: { ...entry.horse, ...overrides } } : entry,
    ),
    noiseStandardDeviation: 0,
  };
}
