import { allSelections, POOL_TYPES, winningSelections, type PoolType } from '@jcb/domain';
import {
  createOutcomeSimulator,
  nextTrialSeed,
  Xoshiro128StarStar,
  type SimulationInput,
} from '@jcb/simulation';

export const ODDS_VERSION = 'outcome-20000-v5-seven-bet-types-temp18';
export const DEFAULT_SIMULATION_COUNT = 20_000;
export const ODDS_TEMPERATURE = 1.8;

export interface SelectionProbability {
  readonly selectionCode: string;
  readonly modelProbability: number;
  readonly baseOdds: number;
}

export interface ProbabilityResult {
  readonly oddsVersion: string;
  readonly simulationCount: number;
  readonly win: readonly SelectionProbability[];
  readonly place: readonly SelectionProbability[];
  readonly quinella: readonly SelectionProbability[];
  readonly exacta: readonly SelectionProbability[];
  readonly wide: readonly SelectionProbability[];
  readonly trio: readonly SelectionProbability[];
  readonly trifecta: readonly SelectionProbability[];
}

export function generateProbabilities(
  input: SimulationInput,
  oddsSeed: string,
  simulationCount = DEFAULT_SIMULATION_COUNT,
): ProbabilityResult {
  if (!Number.isInteger(simulationCount) || simulationCount <= 0) {
    throw new Error('Simulation count must be a positive integer.');
  }
  const selectionCodes = Object.fromEntries(
    POOL_TYPES.map((poolType) => [poolType, allSelections(poolType)]),
  ) as Record<PoolType, readonly string[]>;
  const counts = Object.fromEntries(
    POOL_TYPES.map((poolType) => [
      poolType,
      new Map(selectionCodes[poolType].map((code) => [code, 0])),
    ]),
  ) as Record<PoolType, Map<string, number>>;
  const seedGenerator = new Xoshiro128StarStar(oddsSeed);
  const simulateOutcome = createOutcomeSimulator(input);

  for (let run = 0; run < simulationCount; run += 1) {
    const finishOrder = simulateOutcome(nextTrialSeed(seedGenerator));
    for (const poolType of POOL_TYPES) {
      for (const selection of winningSelections(poolType, finishOrder)) {
        const poolCounts = counts[poolType];
        const current = poolCounts.get(selection);
        if (current === undefined) throw new Error(`Simulator produced an invalid ${poolType}.`);
        poolCounts.set(selection, current + 1);
      }
    }
  }

  const results = Object.fromEntries(
    POOL_TYPES.map((poolType) => [
      poolType,
      createSelectionProbabilities(
        selectionCodes[poolType],
        counts[poolType],
        simulationCount,
        poolType === 'place' || poolType === 'wide' ? 3 : 1,
      ),
    ]),
  ) as Record<PoolType, readonly SelectionProbability[]>;
  return {
    oddsVersion: ODDS_VERSION,
    simulationCount,
    win: results.win,
    place: results.place,
    quinella: results.quinella,
    exacta: results.exacta,
    wide: results.wide,
    trio: results.trio,
    trifecta: results.trifecta,
  };
}

function createSelectionProbabilities(
  selections: readonly string[],
  counts: ReadonlyMap<string, number>,
  simulationCount: number,
  totalProbability: number,
): readonly SelectionProbability[] {
  const raw = selections.map((selection) => {
    const count = counts.get(selection);
    if (count === undefined) throw new Error('Selection count is missing.');
    const smoothed = (count + 0.5) / (simulationCount + 0.5 * selections.length);
    return 0.95 * smoothed + 0.05 * (1 / selections.length);
  });
  return temperProbabilities(raw, ODDS_TEMPERATURE).map((probability, index) => {
    const modelProbability = probability * totalProbability;
    return {
      selectionCode: selections[index]!,
      modelProbability,
      baseOdds: 1 / modelProbability,
    };
  });
}

export function normalizeProbabilities(values: readonly number[]): readonly number[] {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Probabilities must be finite and positive.');
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  const normalized = values.map((value) => value / total);
  const withoutLast = normalized.slice(0, -1);
  const last = 1 - withoutLast.reduce((sum, value) => sum + value, 0);
  return [...withoutLast, last];
}

export function temperProbabilities(
  values: readonly number[],
  temperature: number,
): readonly number[] {
  if (!Number.isFinite(temperature) || temperature < 1) {
    throw new Error('Odds temperature must be a finite number greater than or equal to 1.');
  }
  return normalizeProbabilities(values.map((value) => Math.pow(value, 1 / temperature)));
}

export function createCalibrationReport(result: ProbabilityResult): string {
  const winRows = result.win
    .map(
      (selection) =>
        `| ${selection.selectionCode} | ${(selection.modelProbability * 100).toFixed(3)}% | ${selection.baseOdds.toFixed(1)} |`,
    )
    .join('\n');
  return [
    '# Odds calibration report',
    '',
    `Version: ${result.oddsVersion}`,
    `Runs: ${result.simulationCount}`,
    '',
    '| Horse | Probability | Base odds |',
    '|---:|---:|---:|',
    winRows,
    '',
    ...POOL_TYPES.map(
      (poolType) =>
        `${poolType} selections: ${result[poolType].length}, probability sum: ${result[poolType].reduce((sum, entry) => sum + entry.modelProbability, 0).toFixed(12)}`,
    ),
  ].join('\n');
}
