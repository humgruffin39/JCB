import { kindLabel, processStatusLabel, raceStatusLabel, raceStatusTone } from './admin-labels.js';
import type { AdminRace } from './race-admin-model.js';
import {
  entriesFor,
  formatConditionReadout,
  formatOddsRange,
  formatSeedLiquidity,
  surfaceLabel,
} from './race-admin-utils.js';

export interface RaceAdminListProps {
  readonly races: readonly AdminRace[];
  readonly pendingOperation: string | undefined;
  readonly onEdit: (race: AdminRace, trigger: HTMLElement) => void;
  readonly onTransition: (race: AdminRace, operation: 'lock' | 'unlock') => void | Promise<void>;
  readonly onRetry: (
    race: AdminRace,
    operation: 'simulation' | 'settlement',
  ) => void | Promise<void>;
  readonly onRehearse: (race: AdminRace) => void;
  readonly onReveal: (race: AdminRace) => void;
  readonly onCancel: (race: AdminRace) => void;
}

export function RaceAdminList({
  races,
  pendingOperation,
  onEdit,
  onTransition,
  onRetry,
  onRehearse,
  onReveal,
  onCancel,
}: RaceAdminListProps) {
  return (
    <div className="race-admin-list">
      {races.map((race) => (
        <article
          key={race.id}
          className={`race-admin-card race-admin-card--${raceStatusTone(race.status)}`}
        >
          <header className="race-admin-card__header">
            <div>
              <p className="race-admin-card__eyebrow">
                <time dateTime={race.raceDate}>{race.raceDate}</time> ・ v{String(race.version)}
              </p>
              <h3>{race.name}</h3>
              <p className="race-admin-card__meta">
                {String(race.distanceM)}m ・ {surfaceLabel(race.surface)} ・ {kindLabel(race.kind)}
              </p>
            </div>
            <span className={`status-badge status-badge--${raceStatusTone(race.status)}`}>
              {raceStatusLabel(race.status)}
            </span>
          </header>
          <div className="race-admin-card__body">
            <dl className="race-admin-card__facts">
              <div>
                <dt>正式</dt>
                <dd>{processStatusLabel(race.officialSimulationStatus)}</dd>
              </div>
              <div>
                <dt>オッズ</dt>
                <dd>{processStatusLabel(race.oddsSimulationStatus)}</dd>
              </div>
              <div>
                <dt>基準</dt>
                <dd>{formatOddsRange(race)}</dd>
              </div>
              <div>
                <dt>流動性</dt>
                <dd>{formatSeedLiquidity(race)}</dd>
              </div>
              <div>
                <dt>観戦</dt>
                <dd>{race.timelineObjectKey === null ? '未保存' : '保存済み'}</dd>
              </div>
            </dl>
            {entriesFor(race).some((entry) => entry.condition !== undefined) ? (
              <p className="condition-readout">調子: {formatConditionReadout(race)}</p>
            ) : null}
          </div>
          <div className="inline-actions race-admin-card__actions">
            {race.status === 'draft' ? (
              <button
                type="button"
                className="button-secondary"
                onClick={(event) => onEdit(race, event.currentTarget)}
                disabled={pendingOperation !== undefined}
                aria-label={`${race.name}の下書きを編集`}
              >
                下書きを編集
              </button>
            ) : null}
            {race.status === 'draft' ? (
              <button
                type="button"
                onClick={() => void onTransition(race, 'lock')}
                disabled={pendingOperation !== undefined}
                aria-label={`${race.name}を確定`}
              >
                レースを確定
              </button>
            ) : null}
            {race.status === 'locked' ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => void onTransition(race, 'unlock')}
                disabled={pendingOperation !== undefined}
                aria-label={`${race.name}を下書きへ戻す`}
              >
                下書きへ戻す
              </button>
            ) : null}
            {['failed', 'locked'].includes(race.status) ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => void onRetry(race, 'simulation')}
                disabled={pendingOperation !== undefined}
                aria-label={`${race.name}のシミュレーションを再試行`}
              >
                シミュレーションを再試行
              </button>
            ) : null}
            {['finished', 'settling', 'failed'].includes(race.status) ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => void onRetry(race, 'settlement')}
                disabled={pendingOperation !== undefined}
                aria-label={`${race.name}の精算を再試行`}
              >
                精算再試行
              </button>
            ) : null}
            {race.status === 'betting_open' ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => onRehearse(race)}
                disabled={pendingOperation !== undefined}
                aria-label={`${race.name}を今すぐ進行`}
              >
                今すぐ進行
              </button>
            ) : null}
            {race.officialSimulationStatus === 'completed' &&
            !['finished', 'settling', 'settled', 'cancelled'].includes(race.status) ? (
              <button
                type="button"
                className="button-danger"
                onClick={() => onReveal(race)}
                disabled={pendingOperation !== undefined}
                aria-label={`${race.name}の正式結果を緊急閲覧`}
              >
                緊急結果閲覧
              </button>
            ) : null}
            {['draft', 'locked', 'betting_open', 'betting_closed', 'ready', 'failed'].includes(
              race.status,
            ) ? (
              <button
                type="button"
                className="button-danger"
                onClick={() => onCancel(race)}
                disabled={pendingOperation !== undefined}
                aria-label={`${race.name}を中止`}
              >
                レースを中止
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
