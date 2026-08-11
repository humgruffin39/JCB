import {
  apiErrorSchema,
  betResponseSchema,
  edgeReleaseResponseSchema,
  timelineSchema,
  type TimelineFrameContract,
} from '@jcb/contracts';
import { LocateFixed, Pause, Play, Video, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { apiRequest, EDGE_ORIGIN, estimateServerOffset, getResult } from './api.js';
import type { getRace } from './api.js';
import { synchronizedPosition } from './playback-clock.js';
import { PodiumHorsePreview } from './podium-horse-preview.js';
import { createRaceDramaFrame } from './race-drama.js';
import { SADDLECLOTH_COLORS } from './race-horse-model.js';
import { RaceScene3D } from './race-scene-3d.js';
import type { RaceCameraMode } from './race-world.js';

type RaceDetail = Awaited<ReturnType<typeof getRace>>;
type RaceResult = Awaited<ReturnType<typeof getResult>>;
type TimelineFrame = TimelineFrameContract;
type Bet = ReturnType<typeof betResponseSchema.parse>;
interface LoadedTimeline {
  readonly frames: readonly TimelineFrame[];
  readonly duration: number;
}

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
  const [bets, setBets] = useState<readonly Bet[]>([]);
  const [result, setResult] = useState<RaceResult>();
  const replayAnchor = useRef({ local: performance.now(), position: 0 });

  useEffect(() => {
    void estimateServerOffset()
      .then(setOffset)
      .catch(() => setOffset(0));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiRequest<unknown>(`/api/v1/races/${encodeURIComponent(race.id)}/my-bets`)
      .then((value) => betResponseSchema.array().parse(value))
      .then((value) => {
        if (!cancelled) setBets(value);
      })
      .catch(() => {
        if (!cancelled) setBets([]);
      });
    if (['finished', 'settling', 'settled'].includes(race.status)) {
      void getResult(race.id)
        .then((value) => {
          if (!cancelled) setResult(value);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [race.id, race.status]);

  useEffect(() => {
    let isCancelled = false;
    let isOpening = false;
    let hasLoaded = false;
    const open = async (): Promise<void> => {
      if (isOpening || hasLoaded) return;
      const authoritativeNow = Date.now() + offset;
      if (
        authoritativeNow < race.scheduledAt &&
        !['running', 'finished', 'settling', 'settled'].includes(race.status)
      ) {
        if (!isCancelled) {
          setViewer({
            state: 'waiting',
            message: `${formatCountdown(race.scheduledAt - authoritativeNow)}後に発走`,
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
        const loadedTimeline = await loadTimeline(race.id, token);
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
          setViewer({
            state: 'error',
            message: error instanceof Error ? error.message : 'レース映像を読み込めません',
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
        replayAnchor.current = { local: performance.now(), position };
      } else {
        setPosition(
          synchronizedPosition(
            Date.now(),
            offset,
            race.scheduledAt,
            viewer.duration + FINISH_RUNOUT_MS,
          ),
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
    viewer,
  ]);

  useEffect(() => {
    if (viewer.state !== 'ready' || phase !== 'race' || !hasPlaybackStarted) return;
    const playbackEndMs = viewer.duration + FINISH_RUNOUT_MS;
    const interval = window.setInterval(() => {
      if (isReplay) {
        if (isPaused) return;
        const elapsed = performance.now() - replayAnchor.current.local;
        setPosition(Math.min(playbackEndMs, replayAnchor.current.position + elapsed));
      } else {
        setPosition(synchronizedPosition(Date.now(), offset, race.scheduledAt, playbackEndMs));
      }
    }, 50);
    return () => window.clearInterval(interval);
  }, [hasPlaybackStarted, isPaused, isReplay, offset, phase, race.scheduledAt, viewer]);

  useEffect(() => {
    if (
      viewer.state !== 'ready' ||
      phase !== 'race' ||
      position < viewer.duration + FINISH_RUNOUT_MS
    )
      return;
    setIsPaused(true);
    setPhase('photo');
  }, [phase, position, viewer]);

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
        if (!cancelled) setResult(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [phase, race.id, result, viewer]);

  const timelineFinishOrder = useMemo(() => {
    if (viewer.state !== 'ready') return [];
    const estimates = race.entries.map((entry) => {
      let finishTimeMs = viewer.duration;
      for (let index = 1; index < viewer.frames.length; index += 1) {
        const previousFrame = viewer.frames[index - 1]!;
        const nextFrame = viewer.frames[index]!;
        const previousHorse = previousFrame.horses.find(
          (horse) => horse.horseNumber === entry.horseNumber,
        );
        const nextHorse = nextFrame.horses.find((horse) => horse.horseNumber === entry.horseNumber);
        if (previousHorse === undefined || nextHorse === undefined || nextHorse.progress < 1)
          continue;
        const progressDelta = nextHorse.progress - previousHorse.progress;
        const fraction =
          progressDelta <= 0
            ? 1
            : Math.max(0, Math.min(1, (1 - previousHorse.progress) / progressDelta));
        finishTimeMs = previousFrame.timeMs + (nextFrame.timeMs - previousFrame.timeMs) * fraction;
        break;
      }
      return { horseNumber: entry.horseNumber, finishTimeMs };
    });
    return estimates
      .sort((left, right) => left.finishTimeMs - right.finishTimeMs)
      .map((horse, index) => ({ ...horse, position: index + 1 }));
  }, [race.entries, viewer]);
  const finalOrder = result?.finishOrder ?? timelineFinishOrder;
  const currentFrame = useMemo(() => {
    if (viewer.state !== 'ready') return undefined;
    return createRaceDramaFrame(viewer.frames, position, finalOrder, viewer.duration);
  }, [finalOrder, position, viewer]);
  const orderedHorses = useMemo(
    () => [...(currentFrame?.horses ?? [])].sort((left, right) => left.rank - right.rank),
    [currentFrame],
  );

  const restart = () => {
    setPhase('race');
    setIsReplay(true);
    setIsPaused(false);
    setHasPlaybackStarted(false);
    setPosition(0);
  };

  return (
    <section
      className={`race-broadcast${phase === 'results' ? ' race-broadcast--results' : ''}`}
      aria-label={`${race.name} レース観戦`}
    >
      {phase === 'race' && viewer.state === 'ready' && isSceneReady ? (
        <header className="broadcast-hud">
          <div className="broadcast-title">
            <h1>{race.name}</h1>
            <small>
              {String(race.distanceM)}m・{race.surface === 'turf' ? '芝' : 'ダート'}
            </small>
          </div>
          {viewer.state === 'ready' ? (
            <ol className="running-order" aria-label="現在の走行順">
              {orderedHorses.map((horse) => (
                <li key={horse.horseNumber}>
                  <button
                    type="button"
                    aria-label={`${String(horse.horseNumber)}番を追尾`}
                    aria-pressed={trackedHorseNumber === horse.horseNumber}
                    title={`${String(horse.horseNumber)}番を追尾`}
                    style={
                      {
                        '--horse-number-fill':
                          SADDLECLOTH_COLORS[horse.horseNumber - 1]?.background ?? '#f4f1df',
                        '--horse-number-text':
                          SADDLECLOTH_COLORS[horse.horseNumber - 1]?.foreground ?? '#111111',
                      } as CSSProperties
                    }
                    onClick={() =>
                      setTrackedHorseNumber((current) =>
                        current === horse.horseNumber ? undefined : horse.horseNumber,
                      )
                    }
                  >
                    <strong>{String(horse.horseNumber)}</strong>
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
          <div className="broadcast-race-status">
            <CourseProgressIndicator progress={orderedHorses[0]?.progress ?? 0} />
            <div className="broadcast-clock">
              <output aria-label="再生位置">{(position / 1000).toFixed(1)}s</output>
            </div>
          </div>
        </header>
      ) : null}

      {viewer.state === 'ready' ? (
        <>
          <RaceScene3D
            key={`${race.id}:${String(race.distanceM)}:${race.surface}`}
            frame={currentFrame ?? viewer.frames[0]!}
            positionMs={position}
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
            onReady={() => {
              setIsSceneReady(true);
            }}
          />
          {phase === 'photo' ? <PhotoFinish /> : null}
          {phase === 'results' ? (
            <ResultsScreen
              entries={race.entries}
              finishOrder={finalOrder}
              bets={bets}
              onReplay={restart}
            />
          ) : null}
          {phase === 'race' && isSceneReady ? (
            <PlaybackControls
              isPaused={isPaused}
              cameraMode={cameraMode}
              onPause={() => {
                if (!isReplay) {
                  setIsReplay(true);
                  replayAnchor.current = { local: performance.now(), position };
                }
                setIsPaused((value) => {
                  if (value) replayAnchor.current = { local: performance.now(), position };
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
            />
          ) : null}
        </>
      ) : (
        <BroadcastState state={viewer.state} message={viewer.message} />
      )}
      {connectionError === undefined ? null : (
        <p className="broadcast-connection" role="status">
          通信再試行中
        </p>
      )}
    </section>
  );
}

function PhotoFinish() {
  return (
    <div className="photo-finish" role="status" aria-label="写真判定" aria-live="assertive">
      <div className="photo-flash" />
    </div>
  );
}

function ResultsScreen({
  entries,
  finishOrder,
  bets,
  onReplay,
}: {
  readonly entries: RaceDetail['entries'];
  readonly finishOrder: readonly {
    readonly horseNumber: number;
    readonly position: number;
    readonly finishTimeMs: number;
  }[];
  readonly bets: readonly Bet[];
  readonly onReplay: () => void;
}) {
  const topThree = finishOrder.slice(0, 3);
  return (
    <div className="results-screen" role="region" aria-label="確定結果">
      <ol className="podium">
        {topThree.map((finish) => {
          const entry = entries.find((value) => value.horseNumber === finish.horseNumber);
          const saddlecloth = getSaddleclothStyle(finish.horseNumber);
          return (
            <li
              className={`podium-card podium-card--${String(finish.position)}`}
              key={finish.horseNumber}
            >
              <span className="podium-place">{String(finish.position)}着</span>
              <PodiumHorsePreview
                horseNumber={finish.horseNumber}
                coatColor={entry?.coatColor ?? 'chestnut'}
              />
              <div className="podium-name">
                <span className="podium-horse-number" style={saddlecloth}>
                  {String(finish.horseNumber)}
                </span>
                <strong>{entry?.name ?? `${String(finish.horseNumber)}番`}</strong>
              </div>
            </li>
          );
        })}
      </ol>
      <section className="payout-board" aria-labelledby="payout-heading">
        <div>
          <h3 id="payout-heading">払戻</h3>
        </div>
        {bets.length === 0 ? (
          <p>購入した馬券はありません</p>
        ) : (
          <ul>
            {bets.map((bet) => (
              <li key={bet.id}>
                <div className="ticket-selection">
                  <span className="ticket-type">{bet.poolType === 'win' ? '単勝' : '三連単'}</span>
                  <span
                    className="ticket-horses"
                    aria-label={`${bet.selectionCode.replaceAll('-', '番、')}番`}
                  >
                    {bet.selectionCode.split('-').map((horseNumber) => (
                      <span
                        className="ticket-horse-number"
                        style={getSaddleclothStyle(Number(horseNumber))}
                        key={horseNumber}
                        aria-hidden="true"
                      >
                        {horseNumber}
                      </span>
                    ))}
                  </span>
                </div>
                <div className="ticket-payout">
                  <strong>{BigInt(bet.payout) > 0n ? formatRupees(bet.payout) : 'はずれ'}</strong>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <button className="replay-button" type="button" onClick={onReplay}>
        もう一度見る
      </button>
    </div>
  );
}

function getSaddleclothStyle(horseNumber: number): CSSProperties {
  const colors = SADDLECLOTH_COLORS[horseNumber - 1] ?? SADDLECLOTH_COLORS[0];
  return {
    '--horse-number-fill': colors.background,
    '--horse-number-text': colors.foreground,
  } as CSSProperties;
}

function PlaybackControls({
  isPaused,
  cameraMode,
  onPause,
  onToggleCamera,
}: {
  readonly isPaused: boolean;
  readonly cameraMode: RaceCameraMode;
  readonly onPause: () => void;
  readonly onToggleCamera: () => void;
}) {
  return (
    <div className="broadcast-controls">
      <button
        className="broadcast-icon-button broadcast-camera-button"
        type="button"
        aria-label={cameraMode === 'follow' ? '1位を追尾' : '放送カメラに戻す'}
        aria-pressed={cameraMode === 'horse'}
        title={cameraMode === 'follow' ? '1位を追尾' : '放送カメラに戻す'}
        onClick={onToggleCamera}
      >
        {cameraMode === 'follow' ? (
          <LocateFixed aria-hidden="true" />
        ) : (
          <Video aria-hidden="true" />
        )}
      </button>
      <button
        className="broadcast-icon-button"
        type="button"
        aria-label={isPaused ? '再生' : '一時停止'}
        title={isPaused ? '再生' : '一時停止'}
        onClick={onPause}
      >
        {isPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
      </button>
    </div>
  );
}

export function SoundControls({
  isMuted,
  volume,
  onMute,
  onVolume,
}: {
  readonly isMuted: boolean;
  readonly volume: number;
  readonly onMute: () => void;
  readonly onVolume: (value: number) => void;
}) {
  const isSilent = isMuted || volume === 0;
  return (
    <>
      <button
        className="broadcast-icon-button"
        type="button"
        aria-label={isSilent ? '音声をオン' : '音声をオフ'}
        aria-pressed={!isSilent}
        title={isSilent ? '音声をオン' : '音声をオフ'}
        onClick={onMute}
      >
        {isSilent ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      </button>
      <VolumeSlider value={volume} onChange={onVolume} />
    </>
  );
}

export function VolumeSlider({
  value,
  onChange,
}: {
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  const progress = `${String(Math.round(value * 100))}%`;

  return (
    <label className="volume-slider" style={{ '--volume-progress': progress } as CSSProperties}>
      <span className="sr-only">音量</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <span className="volume-slider__visual" aria-hidden="true">
        <span className="volume-slider__track">
          <span className="volume-slider__fill" />
        </span>
        <span className="volume-slider__thumb" />
      </span>
    </label>
  );
}

function CourseProgressIndicator({ progress }: { readonly progress: number }) {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const percentage = Math.round(clampedProgress * 100);
  return (
    <svg
      className="course-progress"
      viewBox="0 0 80 42"
      role="img"
      aria-label={`先頭はコースの${String(percentage)}パーセント地点`}
    >
      <path
        className="course-progress__base"
        pathLength="1"
        d="M18 7H62A14 14 0 0 1 62 35H18A14 14 0 0 1 18 7Z"
      />
      <path
        className="course-progress__run"
        pathLength="1"
        strokeDasharray={`${String(clampedProgress)} 1`}
        d="M18 7H62A14 14 0 0 1 62 35H18A14 14 0 0 1 18 7Z"
      />
      <path className="course-progress__finish" d="M17 3V11" />
    </svg>
  );
}

function BroadcastState({ state, message }: { readonly state: string; readonly message: string }) {
  return (
    <div
      className={`broadcast-state broadcast-state--${state}`}
      role={state === 'error' ? 'alert' : 'status'}
    >
      <strong>{message}</strong>
    </div>
  );
}

async function loadTimeline(raceId: string, token: string): Promise<LoadedTimeline> {
  const headers = { authorization: `Bearer ${token}` };
  const releaseResponse = await fetch(
    `${EDGE_ORIGIN}/edge/v1/races/${encodeURIComponent(raceId)}/release`,
    { headers },
  );
  if (!releaseResponse.ok) {
    const parsedError = apiErrorSchema.safeParse(await releaseResponse.json());
    throw new Error(
      parsedError.success && parsedError.data.error.code === 'RACE_NOT_STARTED'
        ? '発走時刻前です'
        : 'レース映像の解放情報を取得できません',
    );
  }
  const release = edgeReleaseResponseSchema.parse(await releaseResponse.json()).result;
  if (release.raceId !== raceId) throw new Error('レース識別子が一致しません');
  const timelineResponse = await fetch(`${EDGE_ORIGIN}${release.timelinePath}`, { headers });
  if (!timelineResponse.ok) throw new Error('暗号化されたレース映像を取得できません');
  const ciphertext = new Uint8Array(await timelineResponse.arrayBuffer());
  const authTag = base64Bytes(release.authTag);
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);
  const key = await crypto.subtle.importKey(
    'raw',
    webBuffer(base64Bytes(release.timelineKey)),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: webBuffer(base64Bytes(release.iv)), tagLength: 128 },
    key,
    combined.buffer,
  );
  const decompressed = new Response(
    new Blob([plaintext]).stream().pipeThrough(new DecompressionStream('gzip')),
  );
  return {
    frames: timelineSchema.parse((await decompressed.json()) as unknown),
    duration: release.timelineDuration,
  };
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function webBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatRupees(value: string): string {
  return `${BigInt(value).toLocaleString('ja-JP')} R`;
}
const FINISH_RUNOUT_MS = 500;
