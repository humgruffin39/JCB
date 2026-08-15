import { useCallback, useEffect, useRef, useState } from 'react';

export interface SubmitLock {
  readonly isLocked: boolean;
  readonly lock: () => boolean;
  readonly unlock: () => void;
}

/** Prevents duplicate mutations before React has committed the disabled state. */
export function useSubmitLock(): SubmitLock {
  const lockedRef = useRef(false);
  const mountedRef = useRef(false);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      lockedRef.current = false;
    };
  }, []);

  const lock = useCallback((): boolean => {
    if (lockedRef.current) return false;
    lockedRef.current = true;
    setIsLocked(true);
    return true;
  }, []);

  const unlock = useCallback((): void => {
    lockedRef.current = false;
    if (mountedRef.current) setIsLocked(false);
  }, []);

  return { isLocked, lock, unlock };
}
