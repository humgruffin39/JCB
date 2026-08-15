import type { ProbabilityGenerator } from '@jcb/application';
import type { ProbabilityResult } from '@jcb/odds';
import type { SimulationInput } from '@jcb/simulation';
import { Worker } from 'node:worker_threads';

export class WorkerProbabilityGenerator implements ProbabilityGenerator {
  public async generate(input: SimulationInput, oddsSeed: string): Promise<ProbabilityResult> {
    const isTypeScript = import.meta.url.endsWith('.ts');
    const workerUrl = new URL(
      isTypeScript ? './odds-worker.ts' : './odds-worker.js',
      import.meta.url,
    );
    const worker = new Worker(workerUrl, {
      workerData: { input, oddsSeed },
      execArgv: isTypeScript ? ['--import', 'tsx'] : [],
      resourceLimits: { maxOldGenerationSizeMb: 96 },
    });
    return await waitForProbabilityWorker(worker);
  }
}

type ProbabilityWorker = Pick<Worker, 'off' | 'once' | 'terminate'>;

export function waitForProbabilityWorker(
  worker: ProbabilityWorker,
  timeoutMilliseconds = 90_000,
): Promise<ProbabilityResult> {
  return new Promise<ProbabilityResult>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timeout);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const settle = (outcome: () => void, terminateWorker: boolean): void => {
      if (settled) return;
      settled = true;
      cleanup();
      outcome();
      if (terminateWorker) {
        try {
          void worker.terminate().catch(() => undefined);
        } catch {
          // The result has already settled; termination failure cannot change it.
        }
      }
    };
    const onMessage = (message: unknown): void => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'ok' in message &&
        message.ok === true &&
        'result' in message
      ) {
        settle(() => resolve(message.result as ProbabilityResult), true);
        return;
      }
      const error =
        typeof message === 'object' &&
        message !== null &&
        'error' in message &&
        typeof message.error === 'string'
          ? message.error
          : 'Odds worker failed.';
      settle(() => reject(new Error(error)), true);
    };
    const onError = (error: Error): void => {
      settle(() => reject(new Error('Odds worker emitted an error.', { cause: error })), true);
    };
    const onExit = (code: number): void => {
      settle(
        () =>
          reject(
            new Error(
              code === 0
                ? 'Odds worker exited before returning a result.'
                : `Odds worker exited with code ${String(code)}.`,
            ),
          ),
        false,
      );
    };

    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    const timeout = setTimeout(() => {
      settle(() => reject(new Error('20,000-run odds simulation exceeded 90 seconds.')), true);
    }, timeoutMilliseconds);
  });
}
