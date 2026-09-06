import { identifier, timestamp } from '@jcb/domain';
import type { SimulationInput } from '@jcb/simulation';
import { describe, expect, it, vi } from 'vitest';
import {
  prepareRace,
  withPricedConditions,
  type PrepareRaceDependencies,
  type RacePreparationStart,
} from './prepare-race.js';

const start: RacePreparationStart = {
  raceId: 'race-1',
  raceVersion: 1,
  raceKind: 'regular',
  scheduledAt: timestamp(1_000),
  officialSeed: 'official-seed',
  oddsSeed: 'odds-seed',
  input: {
    raceId: 'race-1',
    raceVersion: 1,
    distanceM: 1_200,
    surface: 'turf',
    entries: Array.from({ length: 8 }, (_, index) => ({
      horseNumber: index + 1,
      condition: 'normal' as const,
      tieBreaker: 0.1 + index * 0.01,
      horse: {
        horseId: identifier(`horse-${String(index + 1)}`),
        name: `Horse ${String(index + 1)}`,
        runningStyle: 'front_runner' as const,
        speed: 50,
        start: 50,
        acceleration: 50,
        stamina: 50,
        lateKick: 50,
        conditionStability: 50,
        distancePreference: 0,
        surfacePreference: 0,
      },
    })),
  },
};

function dependencies(repository: {
  begin: () => RacePreparationStart;
  fail: ReturnType<typeof vi.fn>;
}): PrepareRaceDependencies {
  return {
    repository,
    probabilityGenerator: { generate: vi.fn() },
    timelineMasterSecret: 'timeline-secret',
    resultMasterSecret: 'result-secret',
    manifestPrivateKey: 'private-key',
  } as unknown as PrepareRaceDependencies;
}

describe('prepareRace', () => {
  it('does not fail a race when another preparation already owns the transition', async () => {
    const repository = {
      begin: vi.fn(() => {
        throw new Error('Race cannot transition to simulating.');
      }),
      fail: vi.fn(),
    };

    await expect(prepareRace('race-1', dependencies(repository))).rejects.toThrow(
      'Race cannot transition to simulating.',
    );
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('marks a preparation failed after ownership was acquired', async () => {
    const repository = {
      begin: vi.fn(() => start),
      fail: vi.fn(),
    };
    const deps = dependencies(repository);
    deps.probabilityGenerator.generate = vi.fn().mockRejectedValue(new Error('odds failed'));

    await expect(prepareRace('race-1', deps)).rejects.toThrow('odds failed');
    expect(repository.fail).toHaveBeenCalledWith(
      'race-1',
      'RACE_PREPARATION_FAILED',
      'odds failed',
    );
  });
});

describe('withPricedConditions', () => {
  it('prices every horse at normal so the card stays worth reading', () => {
    const varied: typeof start.input = {
      ...start.input,
      entries: start.input.entries.map((entry, index) => ({
        ...entry,
        condition: (['terrible', 'poor', 'normal', 'good', 'excellent'] as const)[index % 5]!,
      })),
    };
    expect(withPricedConditions(varied).entries.map((entry) => entry.condition)).toEqual(
      Array.from({ length: 8 }, () => 'normal'),
    );
  });

  it('leaves the original input untouched for the official run', () => {
    const varied: typeof start.input = {
      ...start.input,
      entries: start.input.entries.map((entry) => ({ ...entry, condition: 'excellent' as const })),
    };
    withPricedConditions(varied);
    expect(varied.entries.every((entry) => entry.condition === 'excellent')).toBe(true);
  });

  it('keeps everything except condition', () => {
    const priced = withPricedConditions(start.input);
    expect(priced.distanceM).toBe(start.input.distanceM);
    expect(priced.surface).toBe(start.input.surface);
    expect(priced.entries.map((entry) => entry.horse)).toEqual(
      start.input.entries.map((entry) => entry.horse),
    );
  });
});

describe('prepareRace pricing input', () => {
  it('quotes odds without condition while the race keeps it', async () => {
    const varied: RacePreparationStart = {
      ...start,
      input: {
        ...start.input,
        entries: start.input.entries.map((entry) => ({
          ...entry,
          condition: 'excellent' as const,
        })),
      },
    };
    let pricedInput: SimulationInput | undefined;
    const generate = vi.fn(async (input: SimulationInput) => {
      pricedInput = input;
      throw new Error('stop after the generator was called');
    });
    const repository = { begin: () => varied, fail: vi.fn() };
    const dependency = {
      ...dependencies(repository),
      probabilityGenerator: { generate },
    } as PrepareRaceDependencies;

    await expect(prepareRace('race-1', dependency)).rejects.toThrow(/stop after/);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(pricedInput?.entries.every((entry) => entry.condition === 'normal')).toBe(true);
    // The locked lineup the official race runs on still carries its conditions.
    expect(varied.input.entries.every((entry) => entry.condition === 'excellent')).toBe(true);
  });
});
