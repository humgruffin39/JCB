import type { RaceRenderQuality } from './race-viewer-performance.js';

export interface RaceRenderQualitySettings {
  readonly maximumPixelRatio: number;
  readonly maximumPixels: number;
  readonly shadows: boolean;
}

export const RACE_RENDER_QUALITY: Readonly<Record<RaceRenderQuality, RaceRenderQualitySettings>> = {
  high: { maximumPixelRatio: 1.75, maximumPixels: 8_300_000, shadows: true },
  balanced: { maximumPixelRatio: 1.35, maximumPixels: 4_150_000, shadows: true },
  low: { maximumPixelRatio: 1, maximumPixels: 2_100_000, shadows: false },
  minimal: { maximumPixelRatio: 0.8, maximumPixels: 1_200_000, shadows: false },
};

export function renderPixelRatioFor(
  quality: RaceRenderQuality,
  devicePixelRatio: number,
  width: number,
  height: number,
): number {
  const settings = RACE_RENDER_QUALITY[quality];
  const safeDeviceRatio = Number.isFinite(devicePixelRatio) ? Math.max(0.5, devicePixelRatio) : 1;
  const cssPixels = Math.max(1, width) * Math.max(1, height);
  const budgetRatio = Math.sqrt(settings.maximumPixels / cssPixels);
  return Math.max(0.5, Math.min(safeDeviceRatio, settings.maximumPixelRatio, budgetRatio));
}
