import {
  AdvanceIcon,
  CancelIcon,
  EditIcon,
  LockIcon,
  RetryIcon,
  RevealIcon,
  UnlockIcon,
} from './admin-icons.js';
import { raceStatusLabel, raceStatusTone } from './admin-labels.js';
import type { AdminRace } from './race-admin-model.js';
import { formatDateKeyForDisplay, surfaceLabel } from './race-admin-utils.js';

export interface RaceAdminListProps {
  readonly races: readonly AdminRace[];
  readonly betLimits: Readonly<Record<string, number>>;
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

/**
 * A row carries what tells one race from another: when it runs, what it is
 * called, how far, on what, and what a single bet may stake. The simulation and
 * liquidity diagnostics belong to whoever is debugging a race, not to the list
 * of them.
 */
export function RaceAdminList({
  races,
  betLimits,
  pendingOperation,
  onEdit,
  onTransition,
  onRetry,
  onRehearse,
  onReveal,
  onCancel,
}: RaceAdminListProps) {
  return (
    <div className="data-table-wrap">
      <table className="data-table data-table--actions">
        <caption className="visually-hidden">開催一覧</caption>
        <thead>
          <tr>
            <th scope="col">開催日</th>
            <th scope="col">レース</th>
            <th scope="col">距離</th>
            <th scope="col">馬場</th>
            <th scope="col">上限</th>
            <th scope="col">状態</th>
            <th scope="col">
              <span className="visually-hidden">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {races.map((race) => (
            <tr key={race.id}>
              <td>
                <time dateTime={race.raceDate}>{formatDateKeyForDisplay(race.raceDate)}</time>
              </td>
              <td>{race.name}</td>
              <td>{String(race.distanceM)}m</td>
              <td>{surfaceLabel(race.surface)}</td>
              <td>{formatBetLimit(betLimits[race.kind])}</td>
              <td>
                <span className={`status-badge status-badge--${raceStatusTone(race.status)}`}>
                  {raceStatusLabel(race.status)}
                </span>
              </td>
              <td>
                <div className="inline-actions">
                  {race.status === 'draft' ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={(event) => onEdit(race, event.currentTarget)}
                      disabled={pendingOperation !== undefined}
                      aria-label={`${race.name}の下書きを編集`}
                    >
                      <EditIcon size={13} ariaHidden />
                      編集
                    </button>
                  ) : null}
                  {race.status === 'draft' ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void onTransition(race, 'lock')}
                      disabled={pendingOperation !== undefined}
                      aria-label={`${race.name}を確定`}
                    >
                      <LockIcon size={13} ariaHidden />
                      確定
                    </button>
                  ) : null}
                  {race.status === 'locked' ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void onTransition(race, 'unlock')}
                      disabled={pendingOperation !== undefined}
                      aria-label={`${race.name}を下書きへ戻す`}
                    >
                      <UnlockIcon size={13} ariaHidden />
                      下書きへ戻す
                    </button>
                  ) : null}
                  {['failed', 'locked'].includes(race.status) ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void onRetry(race, 'simulation')}
                      disabled={pendingOperation !== undefined}
                      aria-label={`${race.name}のシミュレーションを再試行`}
                    >
                      <RetryIcon size={13} ariaHidden />
                      シミュレーション再試行
                    </button>
                  ) : null}
                  {['finished', 'settling', 'failed'].includes(race.status) ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void onRetry(race, 'settlement')}
                      disabled={pendingOperation !== undefined}
                      aria-label={`${race.name}の精算を再試行`}
                    >
                      <RetryIcon size={13} ariaHidden />
                      精算再試行
                    </button>
                  ) : null}
                  {race.status === 'betting_open' ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onRehearse(race)}
                      disabled={pendingOperation !== undefined}
                      aria-label={`${race.name}を今すぐ進行`}
                    >
                      <AdvanceIcon size={13} ariaHidden />
                      今すぐ進行
                    </button>
                  ) : null}
                  {race.officialSimulationStatus === 'completed' &&
                  !['finished', 'settling', 'settled', 'cancelled'].includes(race.status) ? (
                    <button
                      type="button"
                      className="text-button button-danger"
                      onClick={() => onReveal(race)}
                      disabled={pendingOperation !== undefined}
                      aria-label={`${race.name}の正式結果を緊急閲覧`}
                    >
                      <RevealIcon size={13} ariaHidden />
                      緊急閲覧
                    </button>
                  ) : null}
                  {[
                    'draft',
                    'locked',
                    'betting_open',
                    'betting_closed',
                    'ready',
                    'failed',
                  ].includes(race.status) ? (
                    <button
                      type="button"
                      className="text-button button-danger"
                      onClick={() => onCancel(race)}
                      disabled={pendingOperation !== undefined}
                      aria-label={`${race.name}を中止`}
                    >
                      <CancelIcon size={13} ariaHidden />
                      中止
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatBetLimit(limit: number | undefined): string {
  return limit === undefined ? '—' : `${limit.toLocaleString('ja-JP')} CP`;
}
