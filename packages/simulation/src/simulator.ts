import { PRNG_VERSION, Xoshiro128StarStar } from './prng.js';
import { runSimulation, validateSimulationInput } from './race-engine.js';
import { SIMULATION_VERSION } from './simulation-config.js';
import { stableHash } from './stable-hash.js';
import type { OfficialSimulationResult, SimulationInput } from './simulation-types.js';

export * from './simulation-config.js';
export type * from './simulation-types.js';

export function simulateOfficialRace(
  input: SimulationInput,
  seed: string,
): OfficialSimulationResult {
  const simulation = runSimulation(input, new Xoshiro128StarStar(seed), true);
  const inputHash = hashSimulationInput(input);
  const resultPayload = {
    prngVersion: PRNG_VERSION,
    simulationVersion: SIMULATION_VERSION,
    inputHash,
    timelineDurationMs: simulation.timelineDurationMs,
    finishOrder: simulation.finishOrder,
    timeline: simulation.timeline,
  };
  return {
    ...resultPayload,
    resultHash: stableHash(resultPayload),
  };
}

export function hashSimulationInput(input: SimulationInput): string {
  return stableHash(input);
}

export function verifyOfficialSimulationResult(result: OfficialSimulationResult): boolean {
  const { resultHash, ...payload } = result;
  return (
    /^[a-f0-9]{64}$/.test(resultHash) &&
    stableHash(payload) === resultHash &&
    result.finishOrder.length === 8 &&
    result.timeline.every((frame) => frame.horses.length === 8)
  );
}

export function createOutcomeSimulator(
  input: SimulationInput,
): (seed: string) => readonly number[] {
  validateSimulationInput(input);
  return (seed) =>
    runSimulation(input, new Xoshiro128StarStar(seed), false, false).finishOrder.map(
      (finish) => finish.horseNumber,
    );
}

export function simulateOutcomeOnly(input: SimulationInput, seed: string): readonly number[] {
  return createOutcomeSimulator(input)(seed);
}

export function simulateManyOutcomes(
  input: SimulationInput,
  seed: string,
  count: number,
): readonly (readonly number[])[] {
  if (!Number.isInteger(count) || count <= 0) throw new Error('Simulation count must be positive.');
  const simulate = createOutcomeSimulator(input);
  const seedGenerator = new Xoshiro128StarStar(seed);
  const outcomes: (readonly number[])[] = [];
  for (let index = 0; index < count; index += 1) {
    outcomes.push(simulate(nextTrialSeed(seedGenerator)));
  }
  return outcomes;
}

export function nextTrialSeed(seedGenerator: Xoshiro128StarStar): string {
  return [
    seedGenerator.nextUint32(),
    seedGenerator.nextUint32(),
    seedGenerator.nextUint32(),
    seedGenerator.nextUint32(),
  ].join(':');
}
