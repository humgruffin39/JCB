import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsSectionActive } from './admin-section-visibility.js';

interface AdminPollingState {
  /** True until the first load settles. The pane has nothing to show yet. */
  readonly isInitialLoading: boolean;
  readonly error?: string;
  readonly refreshNow: () => Promise<void>;
}

export function useAdminPolling(
  refresh: () => Promise<void>,
  intervalMilliseconds = 5_000,
): AdminPollingState {
  const isSectionActive = useIsSectionActive();
  const refreshRef = useRef(refresh);
  const queueRef = useRef(Promise.resolve());
  const autoRefreshQueuedRef = useRef(false);
  const mountedRef = useRef(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string>();

  refreshRef.current = refresh;

  const enqueue = useCallback((force: boolean): Promise<void> => {
    if (!force && autoRefreshQueuedRef.current) return queueRef.current;
    if (!force) autoRefreshQueuedRef.current = true;
    const task = queueRef.current.then(async () => {
      if (!force && document.hidden) return;
      try {
        await refreshRef.current();
        if (mountedRef.current) {
          setHasLoaded(true);
          setError(undefined);
        }
      } catch (caught) {
        if (mountedRef.current) {
          setHasLoaded(true);
          setError(caught instanceof Error ? caught.message : '最新情報を取得できません。');
        }
        if (force) throw caught;
      }
    });
    const settledTask = task
      .catch(() => undefined)
      .finally(() => {
        if (!force) autoRefreshQueuedRef.current = false;
      });
    queueRef.current = settledTask;
    return force ? task : settledTask;
  }, []);

  const refreshNow = useCallback(() => enqueue(true), [enqueue]);

  useEffect(() => {
    let active = true;
    let tickRunning = false;
    let timer: number | undefined;
    mountedRef.current = true;
    // A hidden section keeps its rows but stops asking for new ones. Showing it
    // again re-runs this effect, which loads once and resumes the interval.
    if (!isSectionActive) {
      return () => {
        active = false;
        mountedRef.current = false;
      };
    }
    const schedule = (): void => {
      if (active && !document.hidden && timer === undefined) {
        timer = window.setTimeout(tick, Math.max(1_000, intervalMilliseconds));
      }
    };
    const tick = (): void => {
      timer = undefined;
      if (!active || tickRunning) return;
      tickRunning = true;
      void enqueue(false).finally(() => {
        tickRunning = false;
        schedule();
      });
    };
    tick();
    const onVisibilityChange = (): void => {
      if (!active) return;
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      if (document.hidden) return;
      tick();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      mountedRef.current = false;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enqueue, intervalMilliseconds, isSectionActive]);

  return {
    isInitialLoading: !hasLoaded,
    ...(error === undefined ? {} : { error }),
    refreshNow,
  };
}
