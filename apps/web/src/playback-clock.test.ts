import { describe, expect, it } from 'vitest';
import { selectServerOffset, synchronizedPosition } from './playback-clock.js';

describe('viewer synchronization clock', () => {
  it('keeps 50 simulated clients within the p50 and p95 start-skew targets', () => {
    const trueServerNow = 1_800_000_010_000;
    const scheduledStart = trueServerNow - 2_000;
    const positions = Array.from({ length: 50 }, (_, index) => {
      const localClockError = (index - 25) * 37;
      const localNow = trueServerNow + localClockError;
      const estimatedOffset = selectServerOffset([
        { roundTripMilliseconds: 40 + index, offsetMilliseconds: -localClockError + 12 },
        { roundTripMilliseconds: 55 + index, offsetMilliseconds: -localClockError - 9 },
        { roundTripMilliseconds: 70 + index, offsetMilliseconds: -localClockError + 4 },
        { roundTripMilliseconds: 800, offsetMilliseconds: -localClockError + 300 },
        { roundTripMilliseconds: 1_200, offsetMilliseconds: -localClockError - 500 },
      ]);
      return synchronizedPosition(localNow, estimatedOffset, scheduledStart, 60_000);
    });
    const reference = 2_000;
    const skews = positions
      .map((position) => Math.abs(position - reference))
      .sort((left, right) => left - right);

    expect(skews[24]).toBeLessThan(250);
    expect(skews[47]).toBeLessThan(500);
  });

  it('jumps delayed and reconnected clients to the authoritative position', () => {
    expect(synchronizedPosition(15_000, 500, 10_000, 60_000)).toBe(5_500);
    expect(synchronizedPosition(70_000, -250, 10_000, 60_000)).toBe(59_750);
  });
});
