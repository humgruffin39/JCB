import { ApiRequestError } from './api.js';
import { TimelineRequestError } from './race-timeline-loader.js';

export const MAX_VIEWER_RETRIES = 8;

export function viewerRetryDelay(retryCount: number): number {
  return Math.min(15_000, 1_000 * 2 ** Math.max(0, Math.min(4, retryCount)));
}

export function isRetryableViewerError(error: unknown): boolean {
  if (error instanceof ApiRequestError || error instanceof TimelineRequestError) {
    return (
      error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500
    );
  }

  // Browser fetch rejects with TypeError when the connection fails before an
  // HTTP response exists. Contract, decompression and crypto failures use
  // other error types and must not be retried.
  return error instanceof TypeError;
}

export interface ViewerRetryPolicy {
  readonly stopped: boolean;
  nextDelay(error: unknown): number | undefined;
  stop(): void;
}

export function createViewerRetryPolicy(maximumRetries = MAX_VIEWER_RETRIES): ViewerRetryPolicy {
  if (!Number.isSafeInteger(maximumRetries) || maximumRetries < 0) {
    throw new RangeError('maximumRetries must be a non-negative safe integer');
  }

  let retriesScheduled = 0;
  let stopped = false;
  return {
    get stopped() {
      return stopped;
    },
    nextDelay(error) {
      if (stopped) return undefined;
      if (!isRetryableViewerError(error) || retriesScheduled >= maximumRetries) {
        stopped = true;
        return undefined;
      }
      const delay = viewerRetryDelay(retriesScheduled);
      retriesScheduled += 1;
      return delay;
    },
    stop() {
      stopped = true;
    },
  };
}
