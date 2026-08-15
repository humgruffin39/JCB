import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { estimateServerOffset } from './api.js';
import { useActivityRuntime } from './activity-runtime.js';
import type { getRace } from './api.js';
import { shouldCommitPlaybackPosition, synchronizedPosition } from './playback-clock.js';
import { RaceScene3D } from './race-scene-3d.js';
import { finishCameraPositionMs } from './race-world-finish.js';
import type { RaceCameraMode } from './race-world-types.js';
import { BroadcastHud, BroadcastState } from './race-viewer-hud.js';
import { useRaceViewerData } from './race-viewer-data.js';
import { FullscreenControl, PlaybackControls } from './race-viewer-controls.js';
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
import {
  RaceOrientationGate,
  shouldShowRaceOrientationGate,
  useRaceViewerOrientation,
} from './race-viewer-orientation.js';
import { deriveRaceViewerPerformance } from './race-viewer-performance.js';
import { useRaceViewerTimeline } from './race-viewer-timeline.js';

export { SoundControls, VolumeSlider } from './race-viewer-controls.js';

type RaceDetail = Awaited<ReturnType<typeof getRace>>;
type PresentationPhase = 'race' | 'photo' | 'results';

const RACE_START_HOLD_MS = 3_000;

export interface RaceViewerProps {
  readonly race: RaceDetail;
  readonly connectionError?: string;
}

export function RaceViewer(props: RaceViewerProps) {
  return <RaceViewerSession key={`${props.race.id}:${String(props.race.version)}`} {...props} />;
}

function RaceViewerSession({ race, connectionError }: RaceViewerProps) {
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
  const { bets, betsLoading, betsError, result, resultError } = useRaceViewerData({
    raceId: race.id,
    raceStatus: race.status,
    resultRequested: phase !== 'race',
  });
  const broadcastRef = useRef<HTMLElement>(null);
  const activityRuntime = useActivityRuntime();
  const performanceProfile = useMemo(
    () => deriveRaceViewerPerformance(activityRuntime),
    [activityRuntime],
  );
  const playbackPositionRef = useRef(0);
  const displayedPositionRef = useRef(0);
  const replayAnchor = useRef({ local: performance.now(), position: 0 });
  const viewer = useRaceViewerTimeline({
    race,
    serverOffset: offset,
    onLoadedPastEnd: () => {
      setIsReplay(true);
      replayAnchor.current = { local: performance.now(), position: 0 };
    },
  });
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

  const finalOrder = useMemo(
    () => selectFinalOrder(result?.finishOrder, timelineFinishOrder),
    [result?.finishOrder, timelineFinishOrder],
  );
  const currentFrame = useMemo(() => {
    if (viewer.state !== 'ready') return undefined;
    return selectCurrentFrame(viewer.frames, position, finalOrder, viewer.duration);
  }, [finalOrder, position, viewer]);
  const orderedHorses = useMemo(() => selectOrderedHorses(currentFrame), [currentFrame]);
  const { isMobile, isPortrait, isFullscreen, toggleImmersiveMode } = useRaceViewerOrientation(
    broadcastRef,
    activityRuntime.isActivity,
  );
  const shouldShowOrientationGate = shouldShowRaceOrientationGate({
    isActivity: activityRuntime.isActivity,
    isReady: viewer.state === 'ready',
    isResults: phase === 'results',
    isPortrait,
  });
  const effectiveCameraMode = performanceProfile.compact ? 'follow' : cameraMode;
  const effectiveTrackedHorseNumber = performanceProfile.compact ? undefined : trackedHorseNumber;
  const horseCoats = useMemo(
    () =>
      race.entries.map((entry) => ({
        horseNumber: entry.horseNumber,
        coatColor: entry.coatColor,
      })),
    [race.entries],
  );
  const handleFinishSnapshotError = useCallback(() => setFinishSnapshotUnavailable(true), []);
  const handleSceneReady = useCallback(() => setIsSceneReady(true), []);

  useEffect(() => {
    if (!performanceProfile.compact) return;
    setTrackedHorseNumber(undefined);
    setCameraMode('follow');
  }, [performanceProfile.compact]);

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
      className={`race-broadcast${phase === 'results' ? ' race-broadcast--results' : ''}${activityRuntime.isActivity ? ' race-broadcast--activity' : ''}${performanceProfile.compact ? ' race-broadcast--compact' : ''}`}
      data-activity-layout={activityRuntime.isActivity ? activityRuntime.layoutMode : undefined}
      style={
        activityRuntime.isActivity
          ? activitySafeAreaStyle(activityRuntime.safeAreaInsets)
          : undefined
      }
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
              trackedHorseNumber={effectiveTrackedHorseNumber}
              onTrackHorse={setTrackedHorseNumber}
              compact={performanceProfile.compact}
            />
          ) : null}
          <RaceScene3D
            key={`${race.id}:${String(race.distanceM)}:${race.surface}`}
            frames={viewer.frames}
            durationMs={viewer.duration}
            playbackPosition={playbackPositionRef}
            finishOrder={finalOrder}
            isPhoto={phase === 'photo'}
            trackedHorseNumber={effectiveTrackedHorseNumber}
            cameraMode={effectiveCameraMode}
            horseCoats={horseCoats}
            distanceM={race.distanceM}
            surface={race.surface}
            onTrackHorse={setTrackedHorseNumber}
            onCameraModeChange={setCameraMode}
            onFinishSnapshot={setFinishSnapshot}
            onFinishSnapshotError={handleFinishSnapshotError}
            onReady={handleSceneReady}
            renderQuality={performanceProfile.quality}
            minimumFrameIntervalMs={performanceProfile.minimumFrameIntervalMs}
            isInteractive={!performanceProfile.compact}
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
          {phase === 'race' && !performanceProfile.compact ? (
            <PlaybackControls
              isPaused={isPaused}
              canPause={isReplay}
              cameraMode={cameraMode}
              isMobile={isMobile}
              isFullscreen={isFullscreen}
              showFullscreen={!activityRuntime.isActivity}
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
      {viewer.state !== 'ready' && !activityRuntime.isActivity ? (
        <div className="broadcast-controls broadcast-controls--mobile broadcast-loading-controls">
          <FullscreenControl
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => void toggleImmersiveMode()}
          />
        </div>
      ) : null}
      {connectionError === undefined ? null : (
        <p className="broadcast-connection" role="status">
          通信再試行中
        </p>
      )}
      {viewer.state === 'ready' ? (
        <RaceOrientationGate isVisible={shouldShowOrientationGate} />
      ) : null}
    </section>
  );
}

function activitySafeAreaStyle(insets: {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}): CSSProperties {
  return {
    '--jcb-activity-safe-top': `${String(insets.top)}px`,
    '--jcb-activity-safe-right': `${String(insets.right)}px`,
    '--jcb-activity-safe-bottom': `${String(insets.bottom)}px`,
    '--jcb-activity-safe-left': `${String(insets.left)}px`,
  } as CSSProperties;
}
