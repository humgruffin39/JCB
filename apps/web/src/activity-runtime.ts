import { useEffect, useState } from 'react';

export const ACTIVITY_RUNTIME_EVENT = 'jcb:activity-runtime';

export type ActivityLayoutMode = 'focused' | 'pip' | 'grid';
export type ActivityThermalState = 'nominal' | 'fair' | 'serious' | 'critical';

export interface ActivitySafeAreaInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface ActivityRuntimeState {
  readonly isActivity: boolean;
  readonly layoutMode: ActivityLayoutMode;
  readonly thermalState: ActivityThermalState;
  readonly safeAreaInsets: ActivitySafeAreaInsets;
}

export type ActivityRuntimeUpdate = Partial<
  Omit<ActivityRuntimeState, 'safeAreaInsets'> & {
    readonly safeAreaInsets: Partial<ActivitySafeAreaInsets>;
  }
>;

declare global {
  interface Window {
    __JCB_ACTIVITY_RUNTIME__?: ActivityRuntimeUpdate;
  }
}

const ZERO_SAFE_AREA: ActivitySafeAreaInsets = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

export const DEFAULT_ACTIVITY_RUNTIME: ActivityRuntimeState = Object.freeze({
  isActivity: false,
  layoutMode: 'focused',
  thermalState: 'nominal',
  safeAreaInsets: ZERO_SAFE_AREA,
});

export function normalizeActivityRuntime(
  value: ActivityRuntimeUpdate | undefined,
  previous: ActivityRuntimeState = DEFAULT_ACTIVITY_RUNTIME,
): ActivityRuntimeState {
  return {
    isActivity: typeof value?.isActivity === 'boolean' ? value.isActivity : previous.isActivity,
    layoutMode: normalizeLayoutMode(value?.layoutMode, previous.layoutMode),
    thermalState: normalizeThermalState(value?.thermalState, previous.thermalState),
    safeAreaInsets: normalizeSafeArea(value?.safeAreaInsets, previous.safeAreaInsets),
  };
}

export function readActivityRuntime(): ActivityRuntimeState {
  if (typeof window === 'undefined') return DEFAULT_ACTIVITY_RUNTIME;
  return normalizeActivityRuntime(window.__JCB_ACTIVITY_RUNTIME__);
}

/**
 * Activity SDK adapters publish through this function after READY and whenever
 * layout, thermal, or safe-area state changes. Browser viewers never need to call it.
 */
export function publishActivityRuntime(update: ActivityRuntimeUpdate): ActivityRuntimeState {
  if (typeof window === 'undefined') {
    return normalizeActivityRuntime(update);
  }
  const next = normalizeActivityRuntime(update, readActivityRuntime());
  window.__JCB_ACTIVITY_RUNTIME__ = next;
  window.dispatchEvent(
    new CustomEvent<ActivityRuntimeState>(ACTIVITY_RUNTIME_EVENT, { detail: next }),
  );
  return next;
}

export function useActivityRuntime(): ActivityRuntimeState {
  const [runtime, setRuntime] = useState(readActivityRuntime);

  useEffect(() => {
    const handleRuntime = (event: Event): void => {
      const update = (event as CustomEvent<ActivityRuntimeUpdate>).detail;
      setRuntime((current) => normalizeActivityRuntime(update, current));
    };
    window.addEventListener(ACTIVITY_RUNTIME_EVENT, handleRuntime);
    // READY can complete between initial render and effect subscription.
    setRuntime(readActivityRuntime());
    return () => window.removeEventListener(ACTIVITY_RUNTIME_EVENT, handleRuntime);
  }, []);

  return runtime;
}

function normalizeLayoutMode(
  value: ActivityLayoutMode | undefined,
  fallback: ActivityLayoutMode,
): ActivityLayoutMode {
  return value === 'focused' || value === 'pip' || value === 'grid' ? value : fallback;
}

function normalizeThermalState(
  value: ActivityThermalState | undefined,
  fallback: ActivityThermalState,
): ActivityThermalState {
  return value === 'nominal' || value === 'fair' || value === 'serious' || value === 'critical'
    ? value
    : fallback;
}

function normalizeSafeArea(
  value: Partial<ActivitySafeAreaInsets> | undefined,
  fallback: ActivitySafeAreaInsets,
): ActivitySafeAreaInsets {
  return {
    top: normalizeInset(value?.top, fallback.top),
    right: normalizeInset(value?.right, fallback.right),
    bottom: normalizeInset(value?.bottom, fallback.bottom),
    left: normalizeInset(value?.left, fallback.left),
  };
}

function normalizeInset(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(200, Math.max(0, value))
    : fallback;
}
