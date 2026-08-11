import { useCallback, useEffect, useRef, useState } from 'react';

interface AdminPollingState {
  readonly isInitialLoading: boolean;
  readonly error?: string;
  readonly refreshNow: () => Promise<void>;
}

export function useAdminPolling(
  refresh: () => Promise<void>,
  intervalMilliseconds = 5_000,
): AdminPollingState {
  const refreshRef = useRef(refresh);
  const queueRef = useRef(Promise.resolve());
  const autoRefreshQueuedRef = useRef(false);
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
        setHasLoaded(true);
        setError(undefined);
      } catch (caught) {
        setHasLoaded(true);
        setError(caught instanceof Error ? caught.message : '最新情報を取得できません。');
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
    let timer: number | undefined;
    const schedule = (): void => {
      if (active) timer = window.setTimeout(tick, intervalMilliseconds);
    };
    const tick = (): void => {
      if (!active) return;
      void enqueue(false).finally(schedule);
    };
    tick();
    const onVisibilityChange = (): void => {
      if (document.hidden || !active) return;
      if (timer !== undefined) window.clearTimeout(timer);
      tick();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enqueue, intervalMilliseconds]);

  return {
    isInitialLoading: !hasLoaded,
    ...(error === undefined ? {} : { error }),
    refreshNow,
  };
}
