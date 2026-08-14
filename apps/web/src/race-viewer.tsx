import { betResponseSchema } from '@jcb/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, estimateServerOffset, getResult } from './api.js';
import type { getRace } from './api.js';
import { publicErrorMessage } from './public-error-message.js';
import { shouldCommitPlaybackPosition, synchronizedPosition } from './playback-clock.js';
import { RaceScene3D } from './race-scene-3d.js';
import { finishCameraPositionMs } from './race-world-finish.js';
import type { RaceCameraMode } from './race-world-types.js';
import { BroadcastHud, BroadcastState } from './race-viewer-hud.js';
import { PlaybackControls } from './race-viewer-controls.js';
import {
  FinishSnapshot,
  PhotoFinish,
  ResultUnavailable,
  ResultsScreen,
} from './race-viewer-results.js';
import {
  selectCurrentFrame,
  selectFinalOrder,
  selectOrderedHorses,
  selectTimelineFinishOrder,
} from './race-viewer-selectors.js';
import { RaceOrientationGate, useRaceViewerOrientation } from './race-viewer-orientation.js';
import { loadTimeline, type TimelineFrame } from './race-timeline-loader.js';

export { SoundControls, VolumeSlider } from './race-viewer-controls.js';

type RaceDetail = Awaited<ReturnType<typeof getRace>>;
type RaceResult = Awaited<ReturnType<typeof getResult>>;
type Bet = ReturnType<typeof betResponseSchema.parse>;

type ViewerStatus =
  | { readonly state: 'waiting'; readonly message: string }
  | { readonly state: 'loading'; readonly message: string }
  | {
      readonly state: 'ready';
      readonly frames: readonly TimelineFrame[];
      readonly duration: number;
    }
  | { readonly state: 'error'; readonly message: string };

type PresentationPhase = 'race' | 'photo' | 'results';

const RACE_START_HOLD_MS = 3_000;

export function RaceViewer({
  race,
  connectionError,
}: {
  readonly race: RaceDetail;
  readonly connectionError?: string;
}) {
  const [viewer, setViewer] = useState<ViewerStatus>({
    state: 'waiting',
    message: '発走時刻まで待機しています',
  });
  const [offset, setOffset] = useState(0);
  const [position, setPosition] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isReplay, setIsReplay] = useState(() =>
    ['finished', 'settling', 'settled'].includes(race.status),
  );
  const [phase, setPhase] = useState<PresentationPhase>('race');
  const [isSceneReady, setIsSceneReady] = useState(false);
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const [trackedHorseNumber, setTrackedHorseNumber] = useState<number>();
  const [cameraMode, setCameraMode] = useState<RaceCameraMode>('follow');
  const [finishSnapshot, setFinishSnapshot] = useState<string>();
  const [finishSnapshotUnavailable, setFinishSnapshotUnavailable] = useState(false);
  const [bets, setBets] = useState<readonly Bet[]>([]);
  const [betsLoading, setBetsLoading] = useState(true);
  const [betsError, setBetsError] = useState<string>();
  const [result, setResult] = useState<RaceResult>();
  const [resultError, setResultError] = useState<string>();
  const broadcastRef = useRef<HTMLElement>(null);
  const playbackPositionRef = useRef(0);
  const displayedPositionRef = useRef(0);
  const replayAnchor = useRef({ local: performance.now(), position: 0 });
  const timelineFinishOrder = useMemo(
    () =>
      viewer.state === 'ready'
        ? selectTimelineFinishOrder(race.entries, viewer.frames, viewer.duration)
        : [],
    [race.entries, viewer],
  );
  const finishCameraPosition =
    viewer.state === 'ready'
      ? finishCameraPositionMs(
          Math.max(viewer.duration, timelineFinishOrder.at(-1)?.finishTimeMs ?? 0),
        )
      : Number.POSITIVE_INFINITY;

  const updatePlaybackPosition = (nextPosition: number, immediate = false): void => {
    playbackPositionRef.current = nextPosition;
    if (
      shouldCommitPlaybackPosition(
        nextPosition,
        displayedPositionRef.current,
        finishCameraPosition,
        immediate,
      )
    ) {
      displayedPositionRef.current = nextPosition;
      setPosition(nextPosition);
    }
  };

  useEffect(() => {
    void estimateServerOffset()
      .then(setOffset)
      .catch(() => setOffset(0));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBetsLoading(true);
    setBetsError(undefined);
    void apiRequest<unknown>(`/api/v1/races/${encodeURIComponent(race.id)}/my-bets`)
      .then((value) => betResponseSchema.array().parse(value))
      .then((value) => {
        if (!cancelled) {
          setBets(value);
          setBetsLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBetsLoading(false);
          setBetsError(
            publicErrorMessage(
              error,
              '購入情報を取得できません。Discordの#競馬から観戦リンクを開き直してください。',
            ),
          );
        }
      });
    if (['finished', 'settling', 'settled'].includes(race.status)) {
      void getResult(race.id)
        .then((value) => {
          if (!cancelled) {
            setResult(value);
            setResultError(undefined);
          }
        })
        .catch(() => {
          if (!cancelled) setResultError('公式結果を取得できませんでした。');
        });
    }
    return () => {
      cancelled = true;
    };
  }, [race.id, race.status]);

  useEffect(() => {
    let isCancelled = false;
    let isOpening = false;
    let hasLoaded = false;
    let hasFailed = false;
    const open = async (): Promise<void> => {
      if (isOpening || hasLoaded || hasFailed) return;
      if (race.status === 'cancelled') {
        setViewer({ state: 'error', message: 'このレースは中止されました。' });
        hasFailed = true;
        return;
      }
      if (race.status === 'failed') {
        setViewer({ state: 'error', message: 'このレースの準備に失敗しました。' });
        hasFailed = true;
        return;
      }
      const authoritativeNow = Date.now() + offset;
      if (
        authoritativeNow < race.viewerOpensAt &&
        !['running', 'finished', 'settling', 'settled'].includes(race.status)
      ) {
        if (!isCancelled) {
          setViewer({
            state: 'waiting',
            message: `${formatCountdown(race.viewerOpensAt - authoritativeNow)}後に観戦できます`,
          });
        }
        return;
      }
      isOpening = true;
      if (!isCancelled) setViewer({ state: 'loading', message: 'レース映像を準備中' });
      try {
        const tokenKey = `jcb.edge-token:${race.id}`;
        let token = sessionStorage.getItem(tokenKey);
        if (token === null) {
          const refreshed = await apiRequest<{ edgeAccessToken: string }>(
            `/api/v1/races/${encodeURIComponent(race.id)}/edge-token`,
            { method: 'POST' },
          );
          token = refreshed.edgeAccessToken;
          sessionStorage.setItem(tokenKey, token);
        }
        const loadedTimeline = await loadTimeline(race.id, race.version, token);
        if (!isCancelled) {
          hasLoaded = true;
          setViewer({
            state: 'ready',
            frames: loadedTimeline.frames,
            duration: loadedTimeline.duration,
          });
          if (Date.now() + offset >= race.scheduledAt + loadedTimeline.duration) {
            setIsReplay(true);
            replayAnchor.current = { local: performance.now(), position: 0 };
          }
        }
      } catch (error) {
        if (!isCancelled) {
          sessionStorage.removeItem(`jcb.edge-token:${race.id}`);
          hasFailed = true;
          setViewer({
            state: 'error',
            message: publicErrorMessage(error, '通信を確認して、もう一度お試しください。'),
          });
        }
      } finally {
        isOpening = false;
      }
    };
    void open();
    const interval = window.setInterval(() => void open(), 1_000);
    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [offset, race.id, race.scheduledAt, race.status]);

  useEffect(() => {
    if (viewer.state !== 'ready' || phase !== 'race' || !isSceneReady || hasPlaybackStarted) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (isReplay) {
        replayAnchor.current = {
          local: performance.now(),
          position: playbackPositionRef.current,
        };
      } else {
        updatePlaybackPosition(
          synchronizedPosition(Date.now(), offset, race.scheduledAt, finishCameraPosition),
          true,
        );
      }
      setHasPlaybackStarted(true);
    }, RACE_START_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [
    hasPlaybackStarted,
    isReplay,
    isSceneReady,
    offset,
    phase,
    position,
    race.scheduledAt,
    finishCameraPosition,
    viewer,
  ]);

  useEffect(() => {
    if (viewer.state !== 'ready' || phase !== 'race' || !hasPlaybackStarted) return;
    const playbackEndMs = finishCameraPosition;
    const interval = window.setInterval(() => {
      if (isReplay) {
        if (isPaused) return;
        const elapsed = performance.now() - replayAnchor.current.local;
        updatePlaybackPosition(Math.min(playbackEndMs, replayAnchor.current.position + elapsed));
      } else {
        updatePlaybackPosition(
          synchronizedPosition(Date.now(), offset, race.scheduledAt, playbackEndMs),
        );
      }
    }, 50);
    return () => window.clearInterval(interval);
  }, [
    finishCameraPosition,
    hasPlaybackStarted,
    isPaused,
    isReplay,
    offset,
    phase,
    race.scheduledAt,
    viewer,
  ]);

  useEffect(() => {
    if (viewer.state !== 'ready' || phase !== 'race' || position < finishCameraPosition) return;
    if (finishSnapshot === undefined && !finishSnapshotUnavailable) return;
    setIsPaused(true);
    setPhase(finishSnapshotUnavailable ? 'results' : 'photo');
  }, [finishCameraPosition, finishSnapshotUnavailable, finishSnapshot, phase, position, viewer]);

  useEffect(() => {
    if (phase !== 'photo') return;
    const timer = window.setTimeout(() => setPhase('results'), 3_000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (viewer.state !== 'ready' || phase === 'race' || result !== undefined) return;
    let cancelled = false;
    void getResult(race.id)
      .then((value) => {
        if (!cancelled) {
          setResult(value);
          setResultError(undefined);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResultError('公式結果を取得できませんでした。通信状態を確認してください。');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [phase, race.id, result, viewer]);

  const finalOrder = selectFinalOrder(result?.finishOrder, timelineFinishOrder);
  const currentFrame = useMemo(() => {
    if (viewer.state !== 'ready') return undefined;
    return selectCurrentFrame(viewer.frames, position, finalOrder, viewer.duration);
  }, [finalOrder, position, viewer]);
  const orderedHorses = useMemo(() => selectOrderedHorses(currentFrame), [currentFrame]);
  const { isPortrait, isFullscreen, toggleImmersiveMode } = useRaceViewerOrientation(broadcastRef);
  const shouldShowOrientationGate = viewer.state === 'ready' && phase !== 'results' && isPortrait;

  const restart = () => {
    setPhase('race');
    setIsReplay(true);
    setIsPaused(false);
    setHasPlaybackStarted(false);
    updatePlaybackPosition(0, true);
    setFinishSnapshot(undefined);
    setFinishSnapshotUnavailable(false);
  };

  return (
    <section
      ref={broadcastRef}
      className={`race-broadcast${phase === 'results' ? ' race-broadcast--results' : ''}`}
      aria-label={`${race.name} レース観戦`}
    >
      {viewer.state === 'ready' ? (
        <div className="race-viewer-content" inert={shouldShowOrientationGate ? true : undefined}>
          {phase === 'race' && isSceneReady ? (
            <BroadcastHud
              raceName={race.name}
              distanceM={race.distanceM}
              surface={race.surface}
              orderedHorses={orderedHorses}
              position={position}
              trackedHorseNumber={trackedHorseNumber}
              onTrackHorse={setTrackedHorseNumber}
            />
          ) : null}
          <RaceScene3D
            key={`${race.id}:${String(race.distanceM)}:${race.surface}`}
            frames={viewer.frames}
            durationMs={viewer.duration}
            playbackPosition={playbackPositionRef}
            finishOrder={finalOrder}
            isPhoto={phase === 'photo'}
            trackedHorseNumber={trackedHorseNumber}
            cameraMode={cameraMode}
            horseCoats={race.entries.map((entry) => ({
              horseNumber: entry.horseNumber,
              coatColor: entry.coatColor,
            }))}
            distanceM={race.distanceM}
            surface={race.surface}
            onTrackHorse={setTrackedHorseNumber}
            onCameraModeChange={setCameraMode}
            onFinishSnapshot={setFinishSnapshot}
            onFinishSnapshotError={() => setFinishSnapshotUnavailable(true)}
            onReady={() => {
              setIsSceneReady(true);
            }}
          />
          {phase === 'photo' && finishSnapshot !== undefined ? (
            <FinishSnapshot snapshot={finishSnapshot} />
          ) : null}
          {phase === 'photo' ? <PhotoFinish /> : null}
          {phase === 'results' ? (
            result === undefined ? (
              <ResultUnavailable message={resultError} />
            ) : (
              <ResultsScreen
                entries={race.entries}
                finishOrder={result.finishOrder}
                bets={bets}
                betsLoading={betsLoading}
                betsError={betsError}
                onReplay={restart}
              />
            )
          ) : null}
          {phase === 'race' && isSceneReady ? (
            <PlaybackControls
              isPaused={isPaused}
              cameraMode={cameraMode}
              isFullscreen={isFullscreen}
              onPause={() => {
                if (!isReplay) {
                  setIsReplay(true);
                  replayAnchor.current = {
                    local: performance.now(),
                    position: playbackPositionRef.current,
                  };
                }
                setIsPaused((value) => {
                  if (value) {
                    replayAnchor.current = {
                      local: performance.now(),
                      position: playbackPositionRef.current,
                    };
                  }
                  return !value;
                });
              }}
              onToggleCamera={() => {
                if (cameraMode === 'horse') {
                  setTrackedHorseNumber(undefined);
                  setCameraMode('follow');
                  return;
                }
                const leader = orderedHorses.find((horse) => horse.rank === 1) ?? orderedHorses[0];
                if (leader === undefined) return;
                setTrackedHorseNumber(leader.horseNumber);
                setCameraMode('horse');
              }}
              onToggleFullscreen={() => void toggleImmersiveMode()}
            />
          ) : null}
        </div>
      ) : (
        <BroadcastState state={viewer.state} message={viewer.message} />
      )}
      {connectionError === undefined ? null : (
        <p className="broadcast-connection" role="status">
          通信再試行中
        </p>
      )}
      {viewer.state === 'ready' ? (
        <RaceOrientationGate
          isVisible={shouldShowOrientationGate}
          onEnterImmersiveMode={toggleImmersiveMode}
        />
      ) : null}
    </section>
  );
}

function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
