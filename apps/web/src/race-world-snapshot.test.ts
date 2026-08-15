import { describe, expect, it } from 'vitest';
import { fitFinishSnapshotDimensions, MAX_FINISH_SNAPSHOT_PIXELS } from './race-world-snapshot.js';

describe('fitFinishSnapshotDimensions', () => {
  it('preserves ordinary snapshot dimensions', () => {
    expect(fitFinishSnapshotDimensions(1_920, 1_080)).toEqual({ width: 1_920, height: 1_080 });
  });

  it('caps high-DPI snapshots while preserving their aspect ratio', () => {
    const result = fitFinishSnapshotDimensions(6_720, 3_780);
    expect(result.width * result.height).toBeLessThanOrEqual(MAX_FINISH_SNAPSHOT_PIXELS + 2_560);
    expect(result.width / result.height).toBeCloseTo(16 / 9, 2);
  });

  it('returns valid dimensions for malformed or empty drawing buffers', () => {
    expect(fitFinishSnapshotDimensions(0, Number.NaN)).toEqual({ width: 1, height: 1 });
  });
});
