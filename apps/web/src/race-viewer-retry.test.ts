import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api.js';
import { TimelineRequestError } from './race-timeline-loader.js';
import {
  createViewerRetryPolicy,
  isRetryableViewerError,
  viewerRetryDelay,
} from './race-viewer-retry.js';

describe('viewer retry policy', () => {
  it('retries network, not-yet-released, throttled and server failures', () => {
    expect(isRetryableViewerError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryableViewerError(new ApiRequestError('not ready', 425, 'RACE_NOT_STARTED'))).toBe(
      true,
    );
    expect(isRetryableViewerError(new ApiRequestError('busy', 429))).toBe(true);
    expect(isRetryableViewerError(new TimelineRequestError('unavailable', 503))).toBe(true);
  });

  it('stops on authentication, version, schema and decrypt failures', () => {
    expect(isRetryableViewerError(new ApiRequestError('expired', 401, 'AUTH_REQUIRED'))).toBe(
      false,
    );
    expect(isRetryableViewerError(new TimelineRequestError('forbidden', 403))).toBe(false);
    expect(isRetryableViewerError(new TimelineRequestError('version mismatch', 409))).toBe(false);
    expect(isRetryableViewerError(new Error('API response contract is invalid.'))).toBe(false);
    expect(isRetryableViewerError(new DOMException('decrypt failed', 'OperationError'))).toBe(
      false,
    );
  });

  it('backs off, enforces the retry limit and cannot restart after success', () => {
    expect([0, 1, 2, 3, 4, 5].map(viewerRetryDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000,
    ]);

    const limited = createViewerRetryPolicy(2);
    const transient = new ApiRequestError('temporary', 503);
    expect(limited.nextDelay(transient)).toBe(1_000);
    expect(limited.nextDelay(transient)).toBe(2_000);
    expect(limited.nextDelay(transient)).toBeUndefined();
    expect(limited.stopped).toBe(true);

    const successful = createViewerRetryPolicy();
    successful.stop();
    expect(successful.nextDelay(transient)).toBeUndefined();
  });
});
