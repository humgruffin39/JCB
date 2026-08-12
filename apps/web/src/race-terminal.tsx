import { useCallback, useEffect, useRef, useState } from 'react';
import { getPublicSettings, getRace } from './api.js';
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
        setError(caught instanceof Error ? caught.message : 'レース情報を更新できません。');
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
    void refresh();
    const interval = window.setInterval(() => void refresh(), pollMilliseconds);
    return () => window.clearInterval(interval);
  }, [pollMilliseconds, refresh]);

  if (race === undefined) {
    return (
      <section className="race-loading" aria-live="polite" aria-busy="true">
        <p>{error ?? 'レース情報を読み込んでいます'}</p>
      </section>
    );
  }

  return <RaceViewer race={race} {...(error === undefined ? {} : { connectionError: error })} />;
}
