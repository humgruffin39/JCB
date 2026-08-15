import type { TimelineFrameContract } from '@jcb/contracts';
import { memo, useEffect, useRef, useState } from 'react';
import {
  RaceWorld,
  type FinishPosition,
  type RaceCameraMode,
  type RaceWorldState,
} from './race-world.js';
import { createRaceDramaFrame } from './race-drama.js';
import type { HorseCoatColor } from './race-horse-model.js';
import type { RaceSurface } from './race-environment.js';
import { PublicState } from './public-state.js';
import type { RaceRenderQuality } from './race-viewer-performance.js';

export interface RaceScene3DProps {
  readonly frames: readonly TimelineFrameContract[];
  readonly durationMs: number;
  readonly playbackPosition: { readonly current: number };
  readonly finishOrder: readonly FinishPosition[];
  readonly isPhoto: boolean;
  readonly trackedHorseNumber: number | undefined;
  readonly cameraMode: RaceCameraMode;
  readonly onTrackHorse: (horseNumber: number | undefined) => void;
  readonly onCameraModeChange: (mode: RaceCameraMode) => void;
  readonly onFinishSnapshot?: (snapshot: string | undefined) => void;
  readonly onFinishSnapshotError?: () => void;
  readonly horseCoats: readonly {
    readonly horseNumber: number;
    readonly coatColor: HorseCoatColor;
  }[];
  readonly distanceM: number;
  readonly surface: RaceSurface;
  readonly onReady?: () => void;
  readonly renderQuality?: RaceRenderQuality;
  readonly minimumFrameIntervalMs?: number;
  readonly isInteractive?: boolean;
}

function RaceScene3DComponent({
  frames,
  durationMs,
  playbackPosition,
  finishOrder,
  isPhoto,
  trackedHorseNumber,
  cameraMode,
  onTrackHorse,
  onCameraModeChange,
  onFinishSnapshot,
  onFinishSnapshotError,
  horseCoats,
  distanceM,
  surface,
  onReady,
  renderQuality = 'high',
  minimumFrameIntervalMs = 0,
  isInteractive = true,
}: RaceScene3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<RaceWorld | undefined>(undefined);
  const stateRef = useRef<RaceWorldState>({
    frame: frames[0]!,
    positionMs: playbackPosition.current,
    finishOrder,
    isPhoto,
  });
  const framesRef = useRef(frames);
  const durationRef = useRef(durationMs);
  const playbackPositionRef = useRef(playbackPosition);
  const finishOrderRef = useRef(finishOrder);
  const isPhotoRef = useRef(isPhoto);
  const onReadyRef = useRef(onReady);
  const onTrackHorseRef = useRef(onTrackHorse);
  const onCameraModeChangeRef = useRef(onCameraModeChange);
  const onFinishSnapshotRef = useRef(onFinishSnapshot);
  const onFinishSnapshotErrorRef = useRef(onFinishSnapshotError);
  const trackedHorseNumberRef = useRef(trackedHorseNumber);
  const cameraModeRef = useRef(cameraMode);
  const renderQualityRef = useRef(renderQuality);
  const minimumFrameIntervalRef = useRef(minimumFrameIntervalMs);
  const isInteractiveRef = useRef(isInteractive);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [contextGeneration, setContextGeneration] = useState(0);
  framesRef.current = frames;
  durationRef.current = durationMs;
  playbackPositionRef.current = playbackPosition;
  finishOrderRef.current = finishOrder;
  isPhotoRef.current = isPhoto;
  onReadyRef.current = onReady;
  onTrackHorseRef.current = onTrackHorse;
  onCameraModeChangeRef.current = onCameraModeChange;
  onFinishSnapshotRef.current = onFinishSnapshot;
  onFinishSnapshotErrorRef.current = onFinishSnapshotError;
  trackedHorseNumberRef.current = trackedHorseNumber;
  cameraModeRef.current = cameraMode;
  renderQualityRef.current = renderQuality;
  minimumFrameIntervalRef.current = minimumFrameIntervalMs;
  isInteractiveRef.current = isInteractive;

  useEffect(() => {
    worldRef.current?.setTrackedHorse(trackedHorseNumber);
  }, [trackedHorseNumber]);

  useEffect(() => {
    worldRef.current?.setCameraMode(cameraMode);
  }, [cameraMode]);

  useEffect(() => {
    worldRef.current?.setRenderQuality(renderQuality);
  }, [renderQuality]);

  useEffect(() => {
    worldRef.current?.setInteractive(isInteractive);
  }, [isInteractive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let disposed = false;
    let world: RaceWorld | undefined;
    let animationFrame = 0;
    let previousTime = performance.now();
    let previousRenderTime = Number.NEGATIVE_INFINITY;
    let contextLost = false;
    const scheduleRender = (): void => {
      if (
        disposed ||
        contextLost ||
        document.visibilityState === 'hidden' ||
        animationFrame !== 0
      ) {
        return;
      }
      animationFrame = requestAnimationFrame(render);
    };
    const render = (time: number): void => {
      animationFrame = 0;
      if (disposed || contextLost || document.visibilityState === 'hidden') return;
      const interval = Math.max(0, minimumFrameIntervalRef.current);
      if (time - previousRenderTime + 0.1 < interval) {
        scheduleRender();
        return;
      }
      const deltaSeconds = Math.min(0.05, Math.max(0, (time - previousTime) / 1_000));
      previousTime = time;
      previousRenderTime = time;
      const positionMs = playbackPositionRef.current.current;
      stateRef.current = {
        frame: createRaceDramaFrame(
          framesRef.current,
          positionMs,
          finishOrderRef.current,
          durationRef.current,
        ),
        positionMs,
        finishOrder: finishOrderRef.current,
        isPhoto: isPhotoRef.current,
      };
      world?.update(stateRef.current, deltaSeconds);
      scheduleRender();
    };
    const resizeObserver = new ResizeObserver((entries) => {
      if (disposed) return;
      const size = entries[0]?.contentRect;
      if (size !== undefined) world?.resize(size.width, size.height);
    });
    resizeObserver.observe(canvas);
    const handleVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        return;
      }
      previousTime = performance.now();
      previousRenderTime = Number.NEGATIVE_INFINITY;
      const bounds = canvas.getBoundingClientRect();
      world?.resize(bounds.width, bounds.height);
      scheduleRender();
    };
    const handleWindowResize = (): void => {
      const bounds = canvas.getBoundingClientRect();
      world?.resize(bounds.width, bounds.height);
    };
    const handleContextLost = (event: Event): void => {
      event.preventDefault();
      contextLost = true;
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      setStatus('loading');
    };
    const handleContextRestored = (): void => {
      if (disposed) return;
      setContextGeneration((value) => value + 1);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('resize', handleWindowResize);
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    void RaceWorld.create(
      canvas,
      new Map(horseCoats.map((horse) => [horse.horseNumber, horse.coatColor])),
      distanceM,
      surface,
      (mode) => onCameraModeChangeRef.current(mode),
      (horseNumber) => {
        onTrackHorseRef.current?.(horseNumber);
      },
      (snapshot) => {
        onFinishSnapshotRef.current?.(snapshot);
      },
      () => {
        onFinishSnapshotErrorRef.current?.();
      },
      renderQualityRef.current,
    )
      .then((createdWorld) => {
        if (disposed || contextLost) {
          createdWorld.dispose();
          return;
        }
        world = createdWorld;
        worldRef.current = createdWorld;
        world.setTrackedHorse(trackedHorseNumberRef.current);
        world.setCameraMode(cameraModeRef.current);
        world.setInteractive(isInteractiveRef.current);
        world.setRenderQuality(renderQualityRef.current);
        const bounds = canvas.getBoundingClientRect();
        world.resize(bounds.width, bounds.height);
        setStatus('ready');
        onReadyRef.current?.();
        scheduleRender();
      })
      .catch((error: unknown) => {
        if (!disposed && !contextLost) {
          console.error('Failed to initialize 3D race scene', error);
          setStatus('error');
        }
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('resize', handleWindowResize);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      worldRef.current = undefined;
      world?.dispose();
    };
  }, [contextGeneration, distanceM, surface]);

  return (
    <div className="race-scene-3d" aria-busy={status === 'loading'}>
      <canvas ref={canvasRef} aria-hidden="true" />
      {status === 'ready' ? (
        <span className="sr-only" role="img" aria-label="8頭のレース進行アニメーション" />
      ) : null}
      {status === 'loading' ? (
        <PublicState
          className="public-state--scene"
          status="loading"
          heading="レース映像を準備中"
        />
      ) : null}
      {status === 'error' ? (
        <PublicState
          className="public-state--scene"
          status="error"
          heading="レース画面を表示できません"
        />
      ) : null}
    </div>
  );
}

export const RaceScene3D = memo(RaceScene3DComponent);
