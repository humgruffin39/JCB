import { describe, expect, it } from 'vitest';
import { TimelineRequestError } from './race-timeline-loader.js';
import {
  formatCountdown,
  isRefreshableEdgeTokenError,
  timelineRetryDelay,
} from './race-viewer-timeline.js';

describe('race viewer timeline recovery', () => {
  it('backs off transient failures without exceeding fifteen seconds', () => {
    expect([0, 1, 2, 3, 4, 5].map(timelineRetryDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000,
    ]);
  });

  it('formats viewer-open countdowns without negative time', () => {
    expect(formatCountdown(61_001)).toBe('01:02');
    expect(formatCountdown(-100)).toBe('00:00');
  });

  it('refreshes expired or mismatched edge tokens once', () => {
    expect(
      isRefreshableEdgeTokenError(new TimelineRequestError('expired', 401, 'TOKEN_INVALID')),
    ).toBe(true);
    expect(
      isRefreshableEdgeTokenError(
        new TimelineRequestError('wrong race', 403, 'TOKEN_SCOPE_MISMATCH'),
      ),
    ).toBe(true);
    expect(isRefreshableEdgeTokenError(new TimelineRequestError('forbidden', 403))).toBe(false);
  });
});
