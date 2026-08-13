import { type CSSProperties } from 'react';
import { SADDLECLOTH_COLORS } from './race-horse-model.js';
import { PublicState } from './public-state.js';

export interface BroadcastHudHorse {
  readonly horseNumber: number;
  readonly rank: number;
  readonly progress: number;
}

export interface BroadcastHudProps {
  readonly raceName: string;
  readonly distanceM: number;
  readonly surface: 'turf' | 'dirt';
  readonly orderedHorses: readonly BroadcastHudHorse[];
  readonly position: number;
  readonly trackedHorseNumber: number | undefined;
  readonly onTrackHorse: (horseNumber: number | undefined) => void;
}

export function BroadcastHud({
  raceName,
  distanceM,
  surface,
  orderedHorses,
  position,
  trackedHorseNumber,
  onTrackHorse,
}: BroadcastHudProps) {
  return (
    <header className="broadcast-hud">
      <div className="broadcast-title">
        <h1>{raceName}</h1>
        <small>
          {String(distanceM)}m・{surface === 'turf' ? '芝' : 'ダート'}
        </small>
      </div>
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
                onTrackHorse(
                  trackedHorseNumber === horse.horseNumber ? undefined : horse.horseNumber,
                )
              }
            >
              <strong>{String(horse.horseNumber)}</strong>
            </button>
          </li>
        ))}
      </ol>
      <div className="broadcast-race-status">
        <CourseProgressIndicator progress={orderedHorses[0]?.progress ?? 0} />
        <div className="broadcast-clock">
          <output aria-label="再生位置">{(position / 1000).toFixed(1)}s</output>
        </div>
      </div>
    </header>
  );
}

export const RaceViewerHud = BroadcastHud;

export function CourseProgressIndicator({ progress }: { readonly progress: number }) {
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

export function BroadcastState({
  state,
  message,
  onRetry,
}: {
  readonly state: string;
  readonly message: string;
  readonly onRetry?: (() => void) | undefined;
}) {
  return (
    <PublicState
      status={state === 'error' ? 'error' : state === 'waiting' ? 'waiting' : 'loading'}
      heading={state === 'error' ? 'レース映像を読み込めません' : message}
      {...(state === 'error' ? { message } : {})}
      {...(state === 'error' && onRetry !== undefined
        ? { actionLabel: '再試行', onAction: onRetry }
        : {})}
    />
  );
}
