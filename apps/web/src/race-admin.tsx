import { TerminalPanel } from '@jcb/ui';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  conditionLabel,
  kindLabel,
  processStatusLabel,
  raceStatusLabel,
  raceStatusTone,
} from './admin-labels.js';
import { apiAbsoluteUrl, apiRequest, getPublicSettings } from './api.js';
import { useAdminPolling } from './use-admin-polling.js';

interface HorseOption {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

interface AdminRace {
  readonly id: string;
  readonly raceDate: string;
  readonly name: string;
  readonly status: string;
  readonly version: number | string;
  readonly kind: 'regular' | 'midweek' | 'saturday_night';
  readonly distanceM: number | string;
  readonly surface: 'turf' | 'dirt';
  readonly scheduledAt: string;
  readonly bettingOpensAt: string;
  readonly bettingClosesAt: string;
  readonly viewerOpensAt: string;
  readonly entriesJson: string;
  readonly officialSimulationStatus: string | null;
  readonly oddsSimulationStatus: string | null;
  readonly oddsSelectionCount: string;
  readonly minimumBaseOdds: number | string | null;
  readonly maximumBaseOdds: number | string | null;
  readonly seedLiquidity: string;
  readonly seedLiquidityDiagnosticsJson: string | null;
  readonly timelineObjectKey: string | null;
}

interface RaceEntrySelection {
  readonly horseId: string;
  readonly horseNumber: number;
  readonly condition?: string;
}

interface ScheduleSettings {
  readonly recommendedLockTime: string;
  readonly viewerOpenTime: string;
  readonly bettingCloseTime: string;
  readonly startTime: string;
}

const DEFAULT_SCHEDULE: ScheduleSettings = {
  recommendedLockTime: '18:00:00',
  viewerOpenTime: '21:55:00',
  bettingCloseTime: '21:59:30',
  startTime: '22:00:00',
};

const DISTANCE_OPTIONS = [
  800, 1_000, 1_200, 1_400, 1_600, 1_800, 2_000, 2_200, 2_400, 2_600, 2_800, 3_000, 3_200, 3_600,
  4_000, 5_000,
] as const;

export function RaceAdmin() {
  const [races, setRaces] = useState<readonly AdminRace[]>([]);
  const raceRequestId = useRef(0);
  const [horses, setHorses] = useState<readonly HorseOption[]>([]);
  const [schedule, setSchedule] = useState<ScheduleSettings>(DEFAULT_SCHEDULE);
  const [cancelling, setCancelling] = useState<AdminRace>();
  const [rehearsing, setRehearsing] = useState<AdminRace>();
  const [editing, setEditing] = useState<AdminRace>();
  const [revealing, setRevealing] = useState<AdminRace>();
  const [message, setMessage] = useState('');
  const [formOptionsError, setFormOptionsError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [pendingOperation, setPendingOperation] = useState<string>();

  const refreshRaces = useCallback(async () => {
    const requestId = raceRequestId.current + 1;
    raceRequestId.current = requestId;
    const nextRaces = await apiRequest<readonly AdminRace[]>('/api/v1/admin/races', {
      cache: 'no-store',
    });
    if (requestId === raceRequestId.current) setRaces(nextRaces);
  }, []);

  const refreshFormOptions = useCallback(async () => {
    try {
      const [horseRows, publicSettings] = await Promise.all([
        apiRequest<readonly HorseOption[]>('/api/v1/admin/horses'),
        getPublicSettings(),
      ]);
      setHorses(horseRows);
      setSchedule({
        recommendedLockTime: publicSettings.recommendedLockTime,
        viewerOpenTime: publicSettings.viewerOpenTime,
        bettingCloseTime: publicSettings.bettingCloseTime,
        startTime: publicSettings.startTime,
      });
      setFormOptionsError('');
    } catch (caught) {
      setFormOptionsError(caught instanceof Error ? caught.message : '入力候補を取得できません。');
      throw caught;
    }
  }, []);

  const {
    isInitialLoading,
    error: refreshError,
    refreshNow,
  } = useAdminPolling(refreshRaces, 5_000);
  const refresh = useCallback(async () => {
    await refreshNow();
    try {
      await refreshFormOptions();
    } catch {
      // The race list is still usable when only the form options are unavailable.
    }
  }, [refreshFormOptions, refreshNow]);
  useEffect(() => {
    void refreshFormOptions().catch(() => undefined);
  }, [refreshFormOptions]);

  async function runRaceOperation(
    race: AdminRace,
    operation: string,
    action: () => Promise<void>,
    successMessage: string,
  ): Promise<boolean> {
    if (pendingOperation !== undefined) return false;
    setPendingOperation(`${race.id}:${operation}`);
    setOperationError('');
    try {
      await action();
      setMessage(successMessage);
      await refresh();
      return true;
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : '操作を完了できません。');
      return false;
    } finally {
      setPendingOperation(undefined);
    }
  }

  async function transition(race: AdminRace, operation: 'lock' | 'unlock'): Promise<void> {
    await runRaceOperation(
      race,
      operation,
      async () => {
        await apiRequest(`/api/v1/admin/races/${race.id}/${operation}`, {
          method: 'POST',
          body: '{}',
        });
      },
      operation === 'lock'
        ? 'レースを確定し、シミュレーションを予約しました。'
        : 'レースを下書きへ戻しました。',
    );
  }

  async function retry(race: AdminRace, operation: 'simulation' | 'settlement'): Promise<void> {
    await runRaceOperation(
      race,
      `retry-${operation}`,
      async () => {
        await apiRequest(`/api/v1/admin/races/${race.id}/retry-${operation}`, {
          method: 'POST',
          body: '{}',
        });
      },
      operation === 'simulation'
        ? 'シミュレーションの再試行を予約しました。'
        : '精算の再試行を予約しました。',
    );
  }

  async function rehearseNow(race: AdminRace): Promise<void> {
    const succeeded = await runRaceOperation(
      race,
      'rehearse-now',
      async () => {
        await apiRequest(`/api/v1/admin/races/${race.id}/rehearse-now`, {
          method: 'POST',
          body: '{}',
        });
      },
      'リハーサルを精算まで進めました。',
    );
    if (succeeded) {
      setRehearsing(undefined);
    } else {
      throw new Error('操作を完了できません。画面のエラーを確認してください。');
    }
  }

  async function cancelRace(race: AdminRace, reason: string): Promise<void> {
    const succeeded = await runRaceOperation(
      race,
      'cancel',
      async () => {
        await apiRequest(`/api/v1/admin/races/${race.id}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        });
      },
      'レースを中止し、購入済み馬券を全額返金しました。',
    );
    if (succeeded) {
      setCancelling(undefined);
    } else {
      throw new Error('操作を完了できません。画面のエラーを確認してください。');
    }
  }

  return (
    <div className="admin-workspace">
      <TerminalPanel heading="開催一覧">
        {refreshError === undefined ? null : (
          <p className="field-error" role="alert">
            {refreshError}
          </p>
        )}
        {formOptionsError === '' ? null : (
          <p className="field-error" role="alert">
            {formOptionsError}
          </p>
        )}
        {operationError === '' ? null : (
          <p className="field-error" role="alert">
            {operationError}
          </p>
        )}
        {isInitialLoading ? (
          <div className="empty-copy" role="status" aria-live="polite">
            <strong>レース一覧を読み込んでいます</strong>
          </div>
        ) : races.length === 0 ? (
          <div className="empty-copy" role="status">
            <strong>レースがありません</strong>
          </div>
        ) : (
          <div className="race-admin-list">
            {races.map((race) => (
              <article
                key={race.id}
                className={`race-admin-card race-admin-card--${raceStatusTone(race.status)}`}
              >
                <header className="race-admin-card__header">
                  <div>
                    <p className="race-admin-card__eyebrow">
                      <time dateTime={race.raceDate}>{race.raceDate}</time> ・ v
                      {String(race.version)}
                    </p>
                    <h3>{race.name}</h3>
                    <p className="race-admin-card__meta">
                      {String(race.distanceM)}m ・ {surfaceLabel(race.surface)} ・{' '}
                      {kindLabel(race.kind)}
                    </p>
                  </div>
                  <span className={`status-badge status-badge--${raceStatusTone(race.status)}`}>
                    {raceStatusLabel(race.status)}
                  </span>
                </header>
                <div className="race-admin-card__body">
                  <dl className="race-operation-metrics">
                    <div>
                      <dt>正式シミュレーション</dt>
                      <dd>{processStatusLabel(race.officialSimulationStatus)}</dd>
                    </div>
                    <div>
                      <dt>オッズシミュレーション</dt>
                      <dd>{processStatusLabel(race.oddsSimulationStatus)}</dd>
                    </div>
                    <div>
                      <dt>基準オッズ</dt>
                      <dd>{formatOddsRange(race)}</dd>
                    </div>
                    <div>
                      <dt>初期流動性</dt>
                      <dd>{formatSeedLiquidity(race)}</dd>
                    </div>
                    <div>
                      <dt>観戦データ</dt>
                      <dd>{race.timelineObjectKey === null ? '未保存' : '保存済み'}</dd>
                    </div>
                  </dl>
                  {entriesFor(race).some((entry) => entry.condition !== undefined) ? (
                    <p className="condition-readout">
                      調子:{' '}
                      {entriesFor(race)
                        .map(
                          (entry) =>
                            `${String(entry.horseNumber)}番 ${conditionLabel(entry.condition)}`,
                        )
                        .join(' / ')}
                    </p>
                  ) : null}
                </div>
                <div className="inline-actions race-admin-card__actions">
                  {race.status === 'draft' ? (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setEditing(race)}
                      disabled={pendingOperation !== undefined}
                      aria-label={`${race.name}の下書きを編集`}
                    >
                      下書きを編集
                    </button>
                  ) : null}
                  {race.status === 'draft' ? (
                    <button
                      type="button"
                      onClick={() => void transition(race, 'lock')}
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
                      onClick={() => void transition(race, 'unlock')}
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
                      onClick={() => void retry(race, 'simulation')}
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
                      onClick={() => void retry(race, 'settlement')}
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
                      onClick={() => setRehearsing(race)}
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
                      onClick={() => setRevealing(race)}
                      disabled={pendingOperation !== undefined}
                      aria-label={`${race.name}の正式結果を緊急閲覧`}
                    >
                      緊急結果閲覧
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
                      className="button-danger"
                      onClick={() => setCancelling(race)}
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
        )}
      </TerminalPanel>

      <RaceForm
        key={editing?.id ?? 'new-race'}
        horses={horses}
        schedule={schedule}
        {...(editing === undefined ? {} : { race: editing })}
        onSaved={async () => {
          setMessage(
            editing === undefined ? 'レースを下書き保存しました。' : '下書きを更新しました。',
          );
          setEditing(undefined);
          await refresh();
        }}
        onCancel={() => setEditing(undefined)}
      />
      {message === '' ? null : (
        <p className="admin-message" role="status">
          {message}
        </p>
      )}

      {cancelling === undefined ? null : (
        <CancellationDialog
          race={cancelling}
          onClose={() => setCancelling(undefined)}
          onConfirm={cancelRace}
        />
      )}
      {rehearsing === undefined ? null : (
        <RehearsalDialog
          race={rehearsing}
          onClose={() => setRehearsing(undefined)}
          onConfirm={rehearseNow}
        />
      )}
      {revealing === undefined ? null : (
        <EmergencyRevealDialog race={revealing} onClose={() => setRevealing(undefined)} />
      )}
    </div>
  );
}

function RaceForm({
  horses,
  schedule,
  race,
  onSaved,
  onCancel,
}: {
  readonly horses: readonly HorseOption[];
  readonly schedule: ScheduleSettings;
  readonly race?: AdminRace;
  readonly onSaved: () => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedEntries = entriesFor(race);
  const selectedEntriesByNumber = new Map(
    selectedEntries.map((entry) => [entry.horseNumber, entry] as const),
  );
  const [selectedHorseIds, setSelectedHorseIds] = useState<readonly string[]>(() =>
    Array.from({ length: 8 }, (_, index) => selectedEntriesByNumber.get(index + 1)?.horseId ?? ''),
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const raceDate = String(form.get('raceDate'));
    const entries = selectedHorseIds.map((horseId, index) => ({
      horseId,
      horseNumber: index + 1,
    }));
    if (
      entries.some((entry) => entry.horseId === '') ||
      new Set(entries.map((entry) => entry.horseId)).size !== 8
    ) {
      setError('8頭すべてに異なる馬を選んでください。');
      return;
    }
    if (
      entries.some(
        (entry) => horses.find((horse) => horse.id === entry.horseId)?.status === 'retired',
      )
    ) {
      setError('引退した馬は出走馬にできません。別の馬へ交換してください。');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await apiRequest(
        race === undefined ? '/api/v1/admin/races' : `/api/v1/admin/races/${race.id}`,
        {
          method: race === undefined ? 'POST' : 'PATCH',
          body: JSON.stringify({
            raceDate,
            name: String(form.get('name')),
            ...(String(form.get('kind')) === ''
              ? race === undefined
                ? {}
                : { kind: raceKindForDate(raceDate) }
              : { kind: String(form.get('kind')) }),
            distanceM: Number(form.get('distanceM')),
            surface: String(form.get('surface')),
            scheduledAt:
              race === undefined
                ? Date.parse(`${raceDate}T${schedule.startTime}+09:00`)
                : moveTimestampToJstDate(race.scheduledAt, raceDate),
            bettingOpensAt:
              race === undefined
                ? Date.parse(`${raceDate}T${schedule.recommendedLockTime}+09:00`)
                : moveTimestampToJstDate(race.bettingOpensAt, raceDate),
            bettingClosesAt:
              race === undefined
                ? Date.parse(`${raceDate}T${schedule.bettingCloseTime}+09:00`)
                : moveTimestampToJstDate(race.bettingClosesAt, raceDate),
            viewerOpensAt:
              race === undefined
                ? Date.parse(`${raceDate}T${schedule.viewerOpenTime}+09:00`)
                : moveTimestampToJstDate(race.viewerOpensAt, raceDate),
            entries,
          }),
        },
      );
      formElement.reset();
      setSelectedHorseIds(Array.from({ length: 8 }, () => ''));
      setError('');
      await onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '保存できません。入力内容を確認してください。',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const activeHorseCount = horses.filter((horse) => horse.status !== 'retired').length;
  const distanceCandidate = Number(race?.distanceM ?? 1_200);
  const currentDistance = Number.isInteger(distanceCandidate) ? distanceCandidate : 1_200;
  const distanceOptions = Array.from(
    new Set([
      ...DISTANCE_OPTIONS,
      ...(race !== undefined && Number.isInteger(currentDistance) ? [currentDistance] : []),
    ]),
  ).sort((left, right) => left - right);
  return (
    <TerminalPanel heading={race === undefined ? 'レースを作成' : '下書きを編集'}>
      <form className="terminal-form" onSubmit={(event) => void submit(event)}>
        <div className="form-row">
          <label>
            開催日
            <input name="raceDate" type="date" required defaultValue={race?.raceDate} />
          </label>
          <label>
            レース名
            <input name="name" required maxLength={100} defaultValue={race?.name} />
          </label>
          <label>
            種別
            <select name="kind" defaultValue={race?.kind ?? ''}>
              <option value="">曜日から自動決定</option>
              <option value="regular">通常</option>
              <option value="midweek">平日</option>
              <option value="saturday_night">土曜夜</option>
            </select>
          </label>
          <label>
            距離
            <select name="distanceM" defaultValue={String(currentDistance)} required>
              {distanceOptions.map((distance) => (
                <option key={distance} value={distance}>
                  {String(distance)}m
                </option>
              ))}
            </select>
          </label>
          <label>
            コース
            <select name="surface" defaultValue={race?.surface ?? 'turf'}>
              <option value="turf">芝</option>
              <option value="dirt">ダート</option>
            </select>
          </label>
        </div>
        <fieldset className="entry-selects">
          <legend>出走馬（8頭）</legend>
          {Array.from({ length: 8 }, (_, index) => {
            const selectedHorseId = selectedHorseIds[index] ?? '';
            return (
              <label key={index}>
                {String(index + 1)}番
                <select
                  name={`horse-${String(index + 1)}`}
                  required
                  value={selectedHorseId}
                  onChange={(event) => {
                    const nextHorseId = event.currentTarget.value;
                    setSelectedHorseIds((current) =>
                      current.map((horseId, horseIndex) =>
                        horseIndex === index ? nextHorseId : horseId,
                      ),
                    );
                    setError('');
                  }}
                >
                  <option value="" disabled>
                    馬を選択
                  </option>
                  {horses
                    .filter((horse) => horse.status !== 'retired' || horse.id === selectedHorseId)
                    .filter(
                      (horse) =>
                        !selectedHorseIds.some(
                          (selectedHorseIdAtOtherPosition, selectedIndex) =>
                            selectedIndex !== index && selectedHorseIdAtOtherPosition === horse.id,
                        ),
                    )
                    .map((horse) => (
                      <option key={horse.id} value={horse.id}>
                        {horse.status === 'retired'
                          ? `${horse.name}（引退・交換してください）`
                          : horse.name}
                      </option>
                    ))}
                </select>
              </label>
            );
          })}
        </fieldset>
        {activeHorseCount < 8 ? (
          <p className="field-error">レース作成には、引退していない馬が8頭必要です。</p>
        ) : null}
        {error === '' ? null : (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" disabled={activeHorseCount < 8 || isSubmitting}>
            {isSubmitting ? '保存中…' : race === undefined ? '下書きを保存' : '変更を保存'}
          </button>
          {race === undefined ? null : (
            <button
              type="button"
              className="button-secondary"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              編集をやめる
            </button>
          )}
        </div>
      </form>
    </TerminalPanel>
  );
}

function surfaceLabel(surface: AdminRace['surface']): string {
  return surface === 'turf' ? '芝' : 'ダート';
}

function CancellationDialog({
  race,
  onClose,
  onConfirm,
}: {
  readonly race: AdminRace;
  readonly onClose: () => void;
  readonly onConfirm: (race: AdminRace, reason: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await onConfirm(race, reason.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'レースを中止できません。');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="confirmation-dialog"
      aria-labelledby="cancel-race-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
    >
      <form method="dialog" onSubmit={(event) => void submit(event)}>
        <h2 id="cancel-race-title">「{race.name}」を中止しますか</h2>
        <p>販売済み馬券は全額返金され、中止理由と実行者が監査ログへ残ります。</p>
        <label>
          中止理由
          <textarea
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            minLength={3}
            maxLength={300}
            autoFocus
            required
          />
        </label>
        {error === '' ? null : (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="inline-actions">
          <button type="submit" className="button-danger" disabled={isSubmitting}>
            {isSubmitting ? '処理中' : '中止して返金する'}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            戻る
          </button>
        </div>
      </form>
    </dialog>
  );
}

function RehearsalDialog({
  race,
  onClose,
  onConfirm,
}: {
  readonly race: AdminRace;
  readonly onClose: () => void;
  readonly onConfirm: (race: AdminRace) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="confirmation-dialog"
      aria-labelledby="rehearse-race-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setIsSubmitting(true);
          setError('');
          void onConfirm(race)
            .catch((caught: unknown) => {
              setError(caught instanceof Error ? caught.message : 'リハーサルを実行できません。');
            })
            .finally(() => setIsSubmitting(false));
        }}
      >
        <h2 id="rehearse-race-title">「{race.name}」を今すぐ進行しますか</h2>
        <p>
          投票受付を締め切り、発走・レース終了・精算・観戦データ公開まで進めます。リハーサル用の操作です。
        </p>
        {error === '' ? null : (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="inline-actions">
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '処理中…' : 'リハーサルを実行'}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            戻る
          </button>
        </div>
      </form>
    </dialog>
  );
}

function EmergencyRevealDialog({
  race,
  onClose,
}: {
  readonly race: AdminRace;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  async function reveal(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      setResult(
        await apiRequest(`/api/v1/admin/races/${race.id}/emergency-reveal`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '緊急結果を取得できません。');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="confirmation-dialog"
      aria-labelledby="reveal-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
    >
      <form onSubmit={(event) => void reveal(event)}>
        <h2 id="reveal-title">正式結果を緊急閲覧</h2>
        <p>
          <strong>警告:</strong>{' '}
          発走前結果の閲覧です。実行者、理由、IPハッシュが監査ログへ永続記録されます。
        </p>
        <a
          className="button-link"
          href={apiAbsoluteUrl('/api/v1/auth/discord/start?reauthenticate=emergency')}
        >
          Discordで再認証する
        </a>
        <label>
          閲覧理由
          <textarea
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            minLength={10}
            maxLength={500}
            required
          />
        </label>
        {error === '' ? null : (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {result === undefined ? null : (
          <pre className="sealed-result">{JSON.stringify(result, null, 2)}</pre>
        )}
        <div className="inline-actions">
          <button type="submit" className="button-danger" disabled={isSubmitting}>
            {isSubmitting ? '復号中' : '警告を理解して閲覧'}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            閉じる
          </button>
        </div>
      </form>
    </dialog>
  );
}

function entriesFor(race: AdminRace | undefined): readonly RaceEntrySelection[] {
  if (race === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(race.entriesJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry: unknown): entry is RaceEntrySelection => {
        if (typeof entry !== 'object' || entry === null) return false;
        const record = entry as Record<string, unknown>;
        return (
          typeof record.horseId === 'string' &&
          typeof record.horseNumber === 'number' &&
          Number.isInteger(record.horseNumber) &&
          record.horseNumber >= 1 &&
          record.horseNumber <= 8
        );
      })
      .sort((left, right) => left.horseNumber - right.horseNumber);
  } catch {
    return [];
  }
}

function formatOddsRange(race: AdminRace): string {
  if (race.minimumBaseOdds === null || race.maximumBaseOdds === null) return '未生成';
  const minimum = Number(race.minimumBaseOdds);
  const maximum = Number(race.maximumBaseOdds);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return '未生成';
  return `${minimum.toFixed(1)}–${maximum.toFixed(1)}倍 (${race.oddsSelectionCount}通り)`;
}

function formatRupees(value: string): string {
  return /^\d+$/.test(value) ? `${BigInt(value).toLocaleString('ja-JP')} R` : value;
}

function formatSeedLiquidity(race: AdminRace): string {
  if (race.seedLiquidityDiagnosticsJson === null) {
    return formatRupees(race.seedLiquidity);
  }
  try {
    const diagnostics = JSON.parse(race.seedLiquidityDiagnosticsJson) as Record<string, unknown>;
    const applied = Number(diagnostics.appliedWin ?? 0) + Number(diagnostics.appliedTrifecta ?? 0);
    const automatic =
      Number(diagnostics.automaticWin ?? 0) + Number(diagnostics.automaticTrifecta ?? 0);
    const medians =
      diagnostics.winMedian === null
        ? '初期値'
        : `中央値 ${formatRupees(String(diagnostics.winMedian))} / ${formatRupees(String(diagnostics.trifectaMedian))}`;
    return `適用 ${formatRupees(String(applied))} / 自動 ${formatRupees(String(automatic))} / ${medians}`;
  } catch {
    return formatRupees(race.seedLiquidity);
  }
}

function moveTimestampToJstDate(timestampValue: string, raceDate: string): number {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(Number(timestampValue)));
  return Date.parse(`${raceDate}T${time}+09:00`);
}

function raceKindForDate(raceDate: string): 'regular' | 'midweek' | 'saturday_night' {
  const day = new Date(`${raceDate}T12:00:00+09:00`).getUTCDay();
  return day === 3 ? 'midweek' : day === 6 ? 'saturday_night' : 'regular';
}
