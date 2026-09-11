import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVITY_RUNTIME } from './activity-runtime.js';
import { deriveRaceViewerPerformance, deviceRenderCeiling } from './race-viewer-performance.js';

describe('deriveRaceViewerPerformance', () => {
  it('does not alter the existing browser viewer', () => {
    expect(deriveRaceViewerPerformance(DEFAULT_ACTIVITY_RUNTIME)).toEqual({
      quality: 'high',
      minimumFrameIntervalMs: 0,
      compact: false,
    });
  });

  it('reduces PIP rendering while preserving a usable broadcast', () => {
    expect(
      deriveRaceViewerPerformance({
        ...DEFAULT_ACTIVITY_RUNTIME,
        isActivity: true,
        layoutMode: 'pip',
      }),
    ).toMatchObject({ quality: 'balanced', compact: true });
  });

  it('lets the stricter thermal limit win over layout quality', () => {
    const profile = deriveRaceViewerPerformance({
      ...DEFAULT_ACTIVITY_RUNTIME,
      isActivity: true,
      layoutMode: 'focused',
      thermalState: 'critical',
    });

    expect(profile.quality).toBe('minimal');
    expect(profile.minimumFrameIntervalMs).toBe(50);
    expect(profile.compact).toBe(false);
  });

  it('spares a handset the shadow maps a desktop can afford', () => {
    expect(deviceRenderCeiling(360, 640, true)).toBe('low');
    expect(deviceRenderCeiling(844, 390, true)).toBe('low');
    expect(deviceRenderCeiling(1280, 720, false)).toBe('high');
    expect(deriveRaceViewerPerformance(DEFAULT_ACTIVITY_RUNTIME, 'low').quality).toBe('low');
  });
});
