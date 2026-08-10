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
    return await new Promise<ProbabilityResult>((resolve, reject) => {
      const worker = new Worker(workerUrl, {
        workerData: { input, oddsSeed },
        execArgv: isTypeScript ? ['--import', 'tsx'] : [],
        resourceLimits: { maxOldGenerationSizeMb: 96 },
      });
      const timeout = setTimeout(() => {
        void worker.terminate();
        reject(new Error('20,000-run odds simulation exceeded 90 seconds.'));
      }, 90_000);
      worker.once('message', (message: unknown) => {
        clearTimeout(timeout);
        void worker.terminate();
        if (
          typeof message === 'object' &&
          message !== null &&
          'ok' in message &&
          message.ok === true &&
          'result' in message
        ) {
          resolve(message.result as ProbabilityResult);
        } else {
          const error =
            typeof message === 'object' &&
            message !== null &&
            'error' in message &&
            typeof message.error === 'string'
              ? message.error
              : 'Odds worker failed.';
          reject(new Error(error));
        }
      });
      worker.once('error', (error) => {
        clearTimeout(timeout);
        reject(new Error('Odds worker emitted an error.', { cause: error }));
      });
      worker.once('exit', (code) => {
        if (code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`Odds worker exited with code ${String(code)}.`));
        }
      });
    });
  }
}
