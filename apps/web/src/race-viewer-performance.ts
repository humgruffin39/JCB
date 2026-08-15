import type { ActivityRuntimeState } from './activity-runtime.js';

export type RaceRenderQuality = 'high' | 'balanced' | 'low' | 'minimal';

export interface RaceViewerPerformanceProfile {
  readonly quality: RaceRenderQuality;
  readonly minimumFrameIntervalMs: number;
  readonly compact: boolean;
}

const QUALITY_ORDER: readonly RaceRenderQuality[] = ['high', 'balanced', 'low', 'minimal'];

export function deriveRaceViewerPerformance(
  runtime: ActivityRuntimeState,
): RaceViewerPerformanceProfile {
  if (!runtime.isActivity) {
    return { quality: 'high', minimumFrameIntervalMs: 0, compact: false };
  }

  const thermal = (() => {
    switch (runtime.thermalState) {
      case 'nominal':
        return { quality: 'high' as const, interval: 0 };
      case 'fair':
        return { quality: 'balanced' as const, interval: 1_000 / 45 };
      case 'serious':
        return { quality: 'low' as const, interval: 1_000 / 30 };
      case 'critical':
        return { quality: 'minimal' as const, interval: 1_000 / 20 };
    }
  })();
  const layout = (() => {
    switch (runtime.layoutMode) {
      case 'focused':
        return { quality: 'high' as const, interval: 0, compact: false };
      case 'pip':
        return { quality: 'balanced' as const, interval: 1_000 / 30, compact: true };
      case 'grid':
        return { quality: 'low' as const, interval: 1_000 / 20, compact: true };
    }
  })();

  return {
    quality: lowerQuality(thermal.quality, layout.quality),
    minimumFrameIntervalMs: Math.max(thermal.interval, layout.interval),
    compact: layout.compact,
  };
}

function lowerQuality(left: RaceRenderQuality, right: RaceRenderQuality): RaceRenderQuality {
  return QUALITY_ORDER[Math.max(QUALITY_ORDER.indexOf(left), QUALITY_ORDER.indexOf(right))]!;
}
