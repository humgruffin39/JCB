import { useEffect, useRef, useState } from 'react';
import { apiRequest, edgeTokenStorageKey } from './api.js';
import type { getRace } from './api.js';
import { publicErrorMessage } from './public-error-message.js';
import { loadTimeline, TimelineRequestError, type TimelineFrame } from './race-timeline-loader.js';
import { createViewerRetryPolicy, viewerRetryDelay } from './race-viewer-retry.js';

type RaceDetail = Awaited<ReturnType<typeof getRace>>;

export type RaceViewerTimeline =
  | { readonly state: 'waiting'; readonly message: string }
  | { readonly state: 'loading'; readonly message: string }
  | {
      readonly state: 'ready';
      readonly frames: readonly TimelineFrame[];
      readonly duration: number;
    }
  | { readonly state: 'error'; readonly message: string };

const WAITING_TIMELINE: RaceViewerTimeline = {
  state: 'waiting',
  message: '発走時刻まで待機しています',
};

const ACTIVE_STATUSES: ReadonlySet<RaceDetail['status']> = new Set([
  'running',
  'finished',
  'settling',
  'settled',
]);

export function timelineRetryDelay(failureCount: number): number {
  return viewerRetryDelay(failureCount);
}

export function useRaceViewerTimeline({
  race,
  serverOffset,
  onLoadedPastEnd,
}: {
  readonly race: RaceDetail;
  readonly serverOffset: number;
  readonly onLoadedPastEnd: () => void;
}): RaceViewerTimeline {
  const raceKey = `${race.id}:${String(race.version)}`;
  const [resource, setResource] = useState<{
    readonly raceKey: string;
    readonly viewer: RaceViewerTimeline;
  }>(() => ({ raceKey, viewer: WAITING_TIMELINE }));
  const onLoadedPastEndRef = useRef(onLoadedPastEnd);
  onLoadedPastEndRef.current = onLoadedPastEnd;

  useEffect(() => {
    let cancelled = false;
    let opening = false;
    let loaded = false;
    let permanentlyUnavailable = false;
    const retryPolicy = createViewerRetryPolicy();
    let retryAt = 0;
    let retryTimer: number | undefined;
    const controller = new AbortController();

    const open = async (): Promise<void> => {
      if (cancelled || opening || loaded || permanentlyUnavailable || Date.now() < retryAt) return;
      if (race.status === 'cancelled' || race.status === 'failed') {
        permanentlyUnavailable = true;
        setResource({
          raceKey,
          viewer: {
            state: 'error',
            message:
              race.status === 'cancelled'
                ? 'このレースは中止されました。'
                : 'このレースの準備に失敗しました。',
          },
        });
        return;
      }
      const authoritativeNow = Date.now() + serverOffset;
      if (authoritativeNow < race.viewerOpensAt && !ACTIVE_STATUSES.has(race.status)) {
        if (!cancelled) {
          setResource({
            raceKey,
            viewer: {
              state: 'waiting',
              message: `${formatCountdown(race.viewerOpensAt - authoritativeNow)}後に観戦できます`,
            },
          });
        }
        return;
      }

      opening = true;
      if (!cancelled) {
        setResource({
          raceKey,
          viewer: { state: 'loading', message: 'レース映像を準備中' },
        });
      }
      try {
        const tokenKey = edgeTokenStorageKey(race.id);
        let token = sessionStorage.getItem(tokenKey);
        if (token === null) {
          const refreshed = await apiRequest<{ edgeAccessToken: string }>(
            `/api/v1/races/${encodeURIComponent(race.id)}/edge-token`,
            { method: 'POST', signal: controller.signal },
          );
          token = refreshed.edgeAccessToken;
          sessionStorage.setItem(tokenKey, token);
        }
        let timeline: Awaited<ReturnType<typeof loadTimeline>>;
        try {
          timeline = await loadTimeline(race.id, race.version, token, controller.signal);
        } catch (error) {
          if (!isRefreshableEdgeTokenError(error)) throw error;
          sessionStorage.removeItem(tokenKey);
          const refreshed = await apiRequest<{ edgeAccessToken: string }>(
            `/api/v1/races/${encodeURIComponent(race.id)}/edge-token`,
            { method: 'POST', signal: controller.signal },
          );
          token = refreshed.edgeAccessToken;
          sessionStorage.setItem(tokenKey, token);
          timeline = await loadTimeline(race.id, race.version, token, controller.signal);
        }
        if (cancelled) return;
        retryPolicy.stop();
        loaded = true;
        setResource({
          raceKey,
          viewer: { state: 'ready', frames: timeline.frames, duration: timeline.duration },
        });
        if (Date.now() + serverOffset >= race.scheduledAt + timeline.duration) {
          onLoadedPastEndRef.current();
        }
      } catch (error) {
        if (cancelled) return;
        const retryDelay = retryPolicy.nextDelay(error);
        if (retryDelay === undefined) permanentlyUnavailable = true;
        else retryAt = Date.now() + retryDelay;
        setResource({
          raceKey,
          viewer: {
            state: 'error',
            message: publicErrorMessage(error, '通信を確認して、もう一度お試しください。'),
          },
        });
      } finally {
        opening = false;
      }
    };

    const tick = async (): Promise<void> => {
      await open();
      if (!cancelled && !loaded && !permanentlyUnavailable) {
        retryTimer = window.setTimeout(() => void tick(), 1_000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [race.id, race.scheduledAt, race.status, race.version, race.viewerOpensAt, serverOffset]);

  return resource.raceKey === raceKey ? resource.viewer : WAITING_TIMELINE;
}

export function isRefreshableEdgeTokenError(error: unknown): boolean {
  return (
    error instanceof TimelineRequestError &&
    (error.status === 401 ||
      (error.status === 403 &&
        (error.code === 'TOKEN_INVALID' || error.code === 'TOKEN_SCOPE_MISMATCH')))
  );
}

export function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
