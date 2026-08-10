import { parentPort, workerData } from 'node:worker_threads';
import { generateProbabilities } from '@jcb/odds';
import type { SimulationInput } from '@jcb/simulation';

interface OddsWorkerInput {
  readonly input: SimulationInput;
  readonly oddsSeed: string;
}

const request = workerData as OddsWorkerInput;

try {
  const result = generateProbabilities(request.input, request.oddsSeed);
  parentPort?.postMessage({ ok: true, result });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message.slice(0, 300) : 'Unknown odds worker failure',
  });
}
