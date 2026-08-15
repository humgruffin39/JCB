import { describe, expect, it } from 'vitest';
import { renderPixelRatioFor } from './race-world-render-quality.js';

describe('renderPixelRatioFor', () => {
  it('preserves high-DPI rendering on a regular full-HD viewer', () => {
    expect(renderPixelRatioFor('high', 2, 1_920, 1_080)).toBe(1.75);
  });

  it('caps a 4K drawing buffer to prevent a finish-snapshot memory spike', () => {
    const ratio = renderPixelRatioFor('high', 2, 3_840, 2_160);
    expect(ratio).toBeCloseTo(1, 2);
    expect(3_840 * 2_160 * ratio ** 2).toBeLessThanOrEqual(8_300_001);
  });

  it('applies the stricter thermal profile pixel budget', () => {
    const ratio = renderPixelRatioFor('minimal', 3, 2_400, 1_080);
    expect(ratio).toBeLessThan(0.7);
    expect(ratio).toBeGreaterThanOrEqual(0.5);
  });
});
