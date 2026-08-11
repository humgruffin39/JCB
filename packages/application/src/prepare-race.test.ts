import { identifier, timestamp } from '@jcb/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  prepareRace,
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
    timelineStore: { put: vi.fn(async () => undefined) },
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
