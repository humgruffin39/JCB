import type { ProbabilityResult } from '@jcb/odds';
import { EventEmitter } from 'node:events';
import type { Worker } from 'node:worker_threads';
import { waitForProbabilityWorker } from './worker-probability-generator.js';

class FakeWorker extends EventEmitter {
  public terminationCount = 0;
  public emitExitDuringTermination = false;

  public async terminate(): Promise<number> {
    this.terminationCount += 1;
    if (this.emitExitDuringTermination) this.emit('exit', 1);
    return 1;
  }
}

function asWorker(worker: FakeWorker): Pick<Worker, 'off' | 'once' | 'terminate'> {
  return worker as unknown as Pick<Worker, 'off' | 'once' | 'terminate'>;
}

describe('odds worker lifecycle', () => {
  it('rejects immediately when a worker exits successfully without a result', async () => {
    const worker = new FakeWorker();
    const result = waitForProbabilityWorker(asWorker(worker));
    worker.emit('exit', 0);

    await expect(result).rejects.toThrow('before returning a result');
    expect(worker.terminationCount).toBe(0);
  });

  it('settles once and removes exit listeners before terminating after a message', async () => {
    const worker = new FakeWorker();
    worker.emitExitDuringTermination = true;
    const result = waitForProbabilityWorker(asWorker(worker));
    const probability = { selections: [] } as unknown as ProbabilityResult;
    worker.emit('message', { ok: true, result: probability });

    await expect(result).resolves.toBe(probability);
    expect(worker.terminationCount).toBe(1);
    expect(worker.listenerCount('message')).toBe(0);
    expect(worker.listenerCount('error')).toBe(0);
    expect(worker.listenerCount('exit')).toBe(0);
  });

  it('terminates and rejects a worker that exceeds its deadline', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const result = waitForProbabilityWorker(asWorker(worker), 1_000);
      const expectation = expect(result).rejects.toThrow('exceeded 90 seconds');
      await vi.advanceTimersByTimeAsync(1_000);

      await expectation;
      expect(worker.terminationCount).toBe(1);
      expect(worker.listenerCount('exit')).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
