import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVITY_RUNTIME, normalizeActivityRuntime } from './activity-runtime.js';

describe('normalizeActivityRuntime', () => {
  it('keeps the normal browser viewer as the default', () => {
    expect(normalizeActivityRuntime(undefined)).toEqual(DEFAULT_ACTIVITY_RUNTIME);
  });

  it('normalizes an Activity layout and safe area without losing prior values', () => {
    const focused = normalizeActivityRuntime({
      isActivity: true,
      layoutMode: 'focused',
      safeAreaInsets: { top: 18, left: 12 },
    });
    const pip = normalizeActivityRuntime(
      { layoutMode: 'pip', thermalState: 'serious', safeAreaInsets: { right: 20 } },
      focused,
    );

    expect(pip).toEqual({
      isActivity: true,
      layoutMode: 'pip',
      thermalState: 'serious',
      safeAreaInsets: { top: 18, right: 20, bottom: 0, left: 12 },
    });
  });

  it('clamps malformed safe-area values to a bounded CSS-safe range', () => {
    expect(
      normalizeActivityRuntime({ safeAreaInsets: { top: -5, right: 500, bottom: Number.NaN } })
        .safeAreaInsets,
    ).toEqual({ top: 0, right: 200, bottom: 0, left: 0 });
  });
});
