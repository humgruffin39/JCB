import type { TimelineFrameContract } from '@jcb/contracts';
import { useEffect, useRef, useState } from 'react';
import {
  RaceWorld,
  type FinishPosition,
  type RaceCameraMode,
  type RaceWorldState,
} from './race-world.js';
import { createRaceDramaFrame } from './race-drama.js';
import type { HorseCoatColor } from './race-horse-model.js';
import type { RaceSurface } from './race-environment.js';

export function RaceScene3D({
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
}: {
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
}) {
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
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
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

  useEffect(() => {
    worldRef.current?.setTrackedHorse(trackedHorseNumber);
  }, [trackedHorseNumber]);

  useEffect(() => {
    worldRef.current?.setCameraMode(cameraMode);
  }, [cameraMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let disposed = false;
    let world: RaceWorld | undefined;
    let animationFrame = 0;
    let previousTime = performance.now();
    const resizeObserver = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      if (size !== undefined) world?.resize(size.width, size.height);
    });
    resizeObserver.observe(canvas);

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
    )
      .then((createdWorld) => {
        if (disposed) {
          createdWorld.dispose();
          return;
        }
        world = createdWorld;
        worldRef.current = createdWorld;
        world.setTrackedHorse(trackedHorseNumberRef.current);
        world.setCameraMode(cameraModeRef.current);
        const bounds = canvas.getBoundingClientRect();
        world.resize(bounds.width, bounds.height);
        setStatus('ready');
        onReadyRef.current?.();
        const render = (time: number) => {
          const deltaSeconds = Math.min(0.05, Math.max(0, (time - previousTime) / 1_000));
          previousTime = time;
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
          animationFrame = requestAnimationFrame(render);
        };
        animationFrame = requestAnimationFrame(render);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          console.error('Failed to initialize 3D race scene', error);
          setStatus('error');
        }
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      worldRef.current = undefined;
      world?.dispose();
    };
  }, [distanceM, surface]);

  return (
    <div className="race-scene-3d" aria-busy={status === 'loading'}>
      <canvas ref={canvasRef} aria-hidden="true" />
      {status === 'ready' ? (
        <span className="sr-only" role="img" aria-label="8頭のレース進行アニメーション" />
      ) : null}
      {status === 'loading' ? (
        <div className="race-scene-3d__state" role="status">
          <span />
          馬場を準備中
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="race-scene-3d__state race-scene-3d__state--error" role="alert">
          3Dレースを読み込めません
        </div>
      ) : null}
    </div>
  );
}
