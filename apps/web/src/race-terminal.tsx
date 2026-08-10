import { useCallback, useEffect, useState } from 'react';
import { getPublicSettings, getRace } from './api.js';
import { RaceViewer } from './race-viewer.js';

type RaceDetail = Awaited<ReturnType<typeof getRace>>;

export function RaceTerminal({ raceId }: { readonly raceId: string }) {
  const [race, setRace] = useState<RaceDetail>();
  const [error, setError] = useState<string>();
  const [pollMilliseconds, setPollMilliseconds] = useState(15_000);

  const refresh = useCallback(async () => {
    try {
      setRace(await getRace(raceId));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'レース情報を更新できません。');
    }
  }, [raceId]);

  useEffect(() => {
    void getPublicSettings()
      .then((settings) => setPollMilliseconds(settings.webOddsPollMilliseconds))
      .catch(() => setPollMilliseconds(15_000));
  }, []);

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
