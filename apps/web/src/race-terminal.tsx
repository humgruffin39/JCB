import { useCallback, useEffect, useRef, useState } from 'react';
import { getPublicSettings, getRace } from './api.js';
import { publicErrorMessage } from './public-error-message.js';
import { PublicState } from './public-state.js';
import { RaceViewer } from './race-viewer.js';

type RaceDetail = Awaited<ReturnType<typeof getRace>>;

export function RaceTerminal({ raceId }: { readonly raceId: string }) {
  const [race, setRace] = useState<RaceDetail>();
  const [error, setError] = useState<string>();
  const [pollMilliseconds, setPollMilliseconds] = useState(15_000);
  const requestInFlight = useRef(false);
  const requestGeneration = useRef(0);

  const refresh = useCallback(async () => {
    if (requestInFlight.current) return;
    const generation = ++requestGeneration.current;
    requestInFlight.current = true;
    try {
      const nextRace = await getRace(raceId);
      if (generation === requestGeneration.current) {
        setRace(nextRace);
        setError(undefined);
      }
    } catch (caught) {
      if (generation === requestGeneration.current) {
        setError(publicErrorMessage(caught, '通信を確認しています。自動で再試行します。'));
      }
    } finally {
      if (generation === requestGeneration.current) requestInFlight.current = false;
    }
  }, [raceId]);

  useEffect(() => {
    let cancelled = false;
    void getPublicSettings()
      .then((settings) => {
        if (!cancelled) setPollMilliseconds(settings.webOddsPollMilliseconds);
      })
      .catch(() => {
        if (!cancelled) setPollMilliseconds(15_000);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      requestGeneration.current += 1;
      requestInFlight.current = false;
    };
  }, [raceId]);

  useEffect(() => {
    let active = true;
    let tickRunning = false;
    let timer: number | undefined;

    const schedule = (): void => {
      if (active && !document.hidden && timer === undefined) {
        timer = window.setTimeout(tick, Math.max(1_000, pollMilliseconds));
      }
    };
    const tick = (): void => {
      timer = undefined;
      if (!active || tickRunning) return;
      tickRunning = true;
      void refresh().finally(() => {
        tickRunning = false;
        schedule();
      });
    };
    const onVisibilityChange = (): void => {
      if (!active) return;
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      if (document.hidden) return;
      tick();
    };

    tick();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [pollMilliseconds, refresh]);

  if (race === undefined) {
    return (
      <PublicState
        status={error === undefined ? 'loading' : 'error'}
        heading={error === undefined ? 'レース映像を準備中' : 'レース情報を読み込めません'}
        {...(error === undefined ? {} : { message: error })}
      />
    );
  }

  return <RaceViewer race={race} {...(error === undefined ? {} : { connectionError: error })} />;
}
