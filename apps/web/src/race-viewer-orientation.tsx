import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const PORTRAIT_QUERY = '(orientation: portrait)';
const COARSE_POINTER_QUERY = '(pointer: coarse)';

interface ViewerOrientationState {
  readonly isMobile: boolean;
  readonly isPortrait: boolean;
}

function readViewerOrientation(): ViewerOrientationState {
  if (typeof window === 'undefined') {
    return { isMobile: false, isPortrait: false };
  }

  const isMobile =
    window.matchMedia(COARSE_POINTER_QUERY).matches ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  return {
    isMobile,
    isPortrait: isMobile && window.matchMedia(PORTRAIT_QUERY).matches,
  };
}

export function useRaceViewerOrientation(rootRef: RefObject<HTMLElement | null>) {
  const [orientation, setOrientation] = useState(readViewerOrientation);
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && document.fullscreenElement !== null,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateOrientation = (): void => {
      setOrientation(readViewerOrientation());
    };
    const orientationQuery = window.matchMedia(PORTRAIT_QUERY);
    const pointerQuery = window.matchMedia(COARSE_POINTER_QUERY);
    const removeListeners: Array<() => void> = [];

    for (const query of [orientationQuery, pointerQuery]) {
      if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', updateOrientation);
        removeListeners.push(() => query.removeEventListener('change', updateOrientation));
      } else {
        query.addListener(updateOrientation);
        removeListeners.push(() => query.removeListener(updateOrientation));
      }
    }
    window.addEventListener('orientationchange', updateOrientation);
    window.addEventListener('resize', updateOrientation);

    return () => {
      removeListeners.forEach((remove) => remove());
      window.removeEventListener('orientationchange', updateOrientation);
      window.removeEventListener('resize', updateOrientation);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const updateFullscreen = (): void => {
      setIsFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);

  const toggleImmersiveMode = useCallback(async (): Promise<void> => {
    if (typeof document === 'undefined') return;

    if (document.fullscreenElement !== null) {
      try {
        await document.exitFullscreen();
      } catch {
        // Some browsers reject exiting fullscreen after an external interruption.
      }
      return;
    }

    const target = rootRef.current ?? document.documentElement;
    if (typeof target.requestFullscreen !== 'function') return;

    try {
      await target.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      return;
    }

    if (typeof screen === 'undefined' || screen.orientation === undefined) return;
    try {
      await screen.orientation.lock('landscape');
    } catch {
      // Orientation locking is optional; the portrait guidance remains available.
    }
  }, [rootRef]);

  return {
    isMobile: orientation.isMobile,
    isPortrait: orientation.isPortrait,
    isFullscreen,
    toggleImmersiveMode,
  } as const;
}

export function RaceOrientationGate({
  isVisible,
  onEnterImmersiveMode,
}: {
  readonly isVisible: boolean;
  readonly onEnterImmersiveMode: () => Promise<void>;
}) {
  const actionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isVisible) actionRef.current?.focus();
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <section
      className="race-orientation-gate"
      role="status"
      aria-labelledby="race-orientation-heading"
      aria-describedby="race-orientation-message"
    >
      <div className="race-orientation-gate__content">
        <h2 id="race-orientation-heading">端末を横向きにしてください</h2>
        <p id="race-orientation-message">
          画面の向きが固定されている場合は、回転ロックをオフにしてください。
        </p>
        <button ref={actionRef} type="button" onClick={() => void onEnterImmersiveMode()}>
          全画面で観戦
        </button>
      </div>
    </section>
  );
}
