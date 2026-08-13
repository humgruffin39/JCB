import { allTrifectaSelections } from '@jcb/domain';
import { simulateOutcomeOnly, Xoshiro128StarStar, type SimulationInput } from '@jcb/simulation';

export const ODDS_VERSION = 'outcome-20000-v4-preference-axis-temp18';
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
  const winCounts = new Uint32Array(8);
  const trifectaSelections = allTrifectaSelections();
  const trifectaIndex = new Map(trifectaSelections.map((selection, index) => [selection, index]));
  const trifectaCounts = new Uint32Array(trifectaSelections.length);
  const seedGenerator = new Xoshiro128StarStar(oddsSeed);

  for (let run = 0; run < simulationCount; run += 1) {
    const trialSeed = [
      seedGenerator.nextUint32(),
      seedGenerator.nextUint32(),
      seedGenerator.nextUint32(),
      seedGenerator.nextUint32(),
    ].join(':');
    const finishOrder = simulateOutcomeOnly(input, trialSeed);
    winCounts[finishOrder[0]! - 1] = winCounts[finishOrder[0]! - 1]! + 1;
    const trifectaCode = `${finishOrder[0]}-${finishOrder[1]}-${finishOrder[2]}`;
    const combinationIndex = trifectaIndex.get(trifectaCode);
    if (combinationIndex === undefined) throw new Error('Simulator produced an invalid trifecta.');
    trifectaCounts[combinationIndex] = trifectaCounts[combinationIndex]! + 1;
  }

  const winRaw = Array.from(winCounts, (count) => {
    const smoothed = (count + 0.5) / (simulationCount + 0.5 * 8);
    return 0.95 * smoothed + 0.05 * (1 / 8);
  });
  const trifectaRaw = Array.from(trifectaCounts, (count) => {
    const smoothed = (count + 0.25) / (simulationCount + 0.25 * 336);
    return 0.9 * smoothed + 0.1 * (1 / 336);
  });
  const win = temperProbabilities(winRaw, ODDS_TEMPERATURE).map((probability, index) => ({
    selectionCode: String(index + 1),
    modelProbability: probability,
    baseOdds: 1 / probability,
  }));
  const trifecta = temperProbabilities(trifectaRaw, ODDS_TEMPERATURE).map((probability, index) => ({
    selectionCode: trifectaSelections[index]!,
    modelProbability: probability,
    baseOdds: 1 / probability,
  }));
  return { oddsVersion: ODDS_VERSION, simulationCount, win, trifecta };
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
    `Trifecta selections: ${result.trifecta.length}`,
    `Probability sum: ${result.trifecta.reduce((sum, entry) => sum + entry.modelProbability, 0).toFixed(12)}`,
  ].join('\n');
}
