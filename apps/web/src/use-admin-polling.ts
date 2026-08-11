import { useCallback, useEffect, useRef, useState } from 'react';

interface AdminPollingState {
  readonly isInitialLoading: boolean;
  readonly isRefreshing: boolean;
  readonly lastUpdatedAt?: number;
  readonly error?: string;
}

export function useAdminPolling(
  refresh: () => Promise<void>,
  intervalMilliseconds = 5_000,
): AdminPollingState {
  const refreshRef = useRef(refresh);
  const inFlightRef = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>();
  const [error, setError] = useState<string>();

  refreshRef.current = refresh;

  const run = useCallback(async () => {
    if (document.hidden || inFlightRef.current) return;
    inFlightRef.current = true;
    setIsRefreshing(true);
    try {
      await refreshRef.current();
      setHasLoaded(true);
      setLastUpdatedAt(Date.now());
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '最新情報を取得できません。');
    } finally {
      inFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const tick = (): void => {
      if (active) void run();
    };
    tick();
    const timer = window.setInterval(tick, intervalMilliseconds);
    const onVisibilityChange = (): void => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMilliseconds, run]);

  return {
    isInitialLoading: !hasLoaded,
    isRefreshing,
    ...(lastUpdatedAt === undefined ? {} : { lastUpdatedAt }),
    ...(error === undefined ? {} : { error }),
  };
}
