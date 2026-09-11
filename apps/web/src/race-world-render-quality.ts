import type * as THREE from 'three';
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

const QUALITY_ORDER: readonly RaceRenderQuality[] = ['high', 'balanced', 'low', 'minimal'];

/**
 * True when the page is being drawn by the CPU instead of a GPU — a headless
 * runner, a virtual machine, or a browser that has fallen back after a driver
 * crash. Every real phone has a GPU, so this never costs a handset its quality.
 */
export function isSoftwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render|paravirtual/i.test(name);
}

export function rendererName(renderer: THREE.WebGLRenderer): string {
  try {
    const context = renderer.getContext();
    const info = context.getExtension('WEBGL_debug_renderer_info');
    if (info === null) return '';
    return String(context.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch {
    return '';
  }
}

/** The stricter of two qualities. */
export function lowerRenderQuality(
  left: RaceRenderQuality,
  right: RaceRenderQuality,
): RaceRenderQuality {
  return QUALITY_ORDER[Math.max(QUALITY_ORDER.indexOf(left), QUALITY_ORDER.indexOf(right))]!;
}

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
