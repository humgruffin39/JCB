import { compareSnowflakes } from '../utilities/snowflake.js';

interface QueueEntry<T extends { readonly id: string }> {
  readonly item: T;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

export interface ProcessingQueueOptions {
  readonly onFatal?: (error: unknown) => void;
}

export class ProcessingQueue<T extends { readonly id: string }> {
  private entries: QueueEntry<T>[] = [];
  private accepting = true;
  private running = false;
  private scheduled = false;
  private fatalError: unknown = null;
  private idleWaiters: Array<() => void> = [];

  public constructor(
    private readonly handler: (item: T) => Promise<void>,
    private readonly options: ProcessingQueueOptions = {},
  ) {}

  public get isRunning(): boolean {
    return this.accepting && this.fatalError === null;
  }

  public get hasFatalError(): boolean {
    return this.fatalError !== null;
  }

  public enqueue(item: T): Promise<void> {
    return this.enqueueMany([item])[0] ?? Promise.resolve();
  }

  public enqueueMany(items: readonly T[]): Promise<void>[] {
    if (!this.accepting || this.fatalError !== null) {
      const error = this.asError(
        this.fatalError ?? new Error('Processing queue is not accepting messages'),
      );
      return items.map(() => Promise.reject(error));
    }

    const promises = items.map(
      (item) =>
        new Promise<void>((resolvePromise, rejectPromise) => {
          this.entries.push({
            item,
            resolve: resolvePromise,
            reject: rejectPromise,
          });
        }),
    );
    this.entries.sort((left, right) => compareSnowflakes(left.item.id, right.item.id));
    this.schedule();
    return promises;
  }

  public stopAccepting(): void {
    this.accepting = false;
    this.resolveIdleIfNeeded();
  }

  public async waitForIdle(): Promise<void> {
    if (!this.running && this.entries.length === 0) {
      return;
    }
    await new Promise<void>((resolvePromise) => {
      this.idleWaiters.push(resolvePromise);
    });
  }

  private schedule(): void {
    if (this.scheduled || this.running) {
      return;
    }
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running || this.fatalError !== null) {
      return;
    }
    this.running = true;

    try {
      while (this.entries.length > 0) {
        this.entries.sort((left, right) => compareSnowflakes(left.item.id, right.item.id));
        const entry = this.entries.shift();
        if (entry === undefined) {
          continue;
        }

        try {
          await this.handler(entry.item);
          entry.resolve();
        } catch (error) {
          const fatalError = this.asError(error);
          entry.reject(fatalError);
          this.fatalError = fatalError;
          for (const waiting of this.entries.splice(0)) {
            waiting.reject(fatalError);
          }
          this.options.onFatal?.(fatalError);
          break;
        }
      }
    } finally {
      this.running = false;
      this.resolveIdleIfNeeded();
      if (this.entries.length > 0 && this.fatalError === null) {
        this.schedule();
      }
    }
  }

  private resolveIdleIfNeeded(): void {
    if (this.running || this.entries.length > 0) {
      return;
    }
    for (const resolvePromise of this.idleWaiters.splice(0)) {
      resolvePromise();
    }
  }

  private asError(error: unknown): Error {
    return error instanceof Error ? error : new Error('Processing queue failed', { cause: error });
  }
}
