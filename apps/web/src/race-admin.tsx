import { TerminalPanel } from '@jcb/ui';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { apiAbsoluteUrl, apiRequest, getPublicSettings } from './api.js';

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
  readonly version: number;
  readonly kind: 'regular' | 'midweek' | 'saturday_night';
  readonly distanceM: number;
  readonly surface: 'turf' | 'dirt';
  readonly scheduledAt: string;
  readonly bettingOpensAt: string;
  readonly bettingClosesAt: string;
  readonly viewerOpensAt: string;
  readonly entriesJson: string;
  readonly officialSimulationStatus: string | null;
  readonly oddsSimulationStatus: string | null;
  readonly oddsSelectionCount: string;
  readonly minimumBaseOdds: number | null;
  readonly maximumBaseOdds: number | null;
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

export function RaceAdmin() {
  const [races, setRaces] = useState<readonly AdminRace[]>([]);
  const [horses, setHorses] = useState<readonly HorseOption[]>([]);
  const [schedule, setSchedule] = useState<ScheduleSettings>(DEFAULT_SCHEDULE);
  const [cancelling, setCancelling] = useState<AdminRace>();
  const [editing, setEditing] = useState<AdminRace>();
  const [revealing, setRevealing] = useState<AdminRace>();
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    const [raceRows, horseRows, publicSettings] = await Promise.all([
      apiRequest<readonly AdminRace[]>('/api/v1/admin/races'),
      apiRequest<readonly HorseOption[]>('/api/v1/admin/horses'),
      getPublicSettings(),
    ]);
    setRaces(raceRows);
    setHorses(horseRows.filter((horse) => horse.status !== 'retired'));
    setSchedule({
      recommendedLockTime: publicSettings.recommendedLockTime,
      viewerOpenTime: publicSettings.viewerOpenTime,
      bettingCloseTime: publicSettings.bettingCloseTime,
      startTime: publicSettings.startTime,
    });
  }, []);

  useEffect(() => void refresh(), [refresh]);

  async function transition(race: AdminRace, operation: 'lock' | 'unlock'): Promise<void> {
    await apiRequest(`/api/v1/admin/races/${race.id}/${operation}`, {
      method: 'POST',
      body: '{}',
    });
    setMessage(
      operation === 'lock'
        ? 'レースを確定し、シミュレーションを予約しました。'
        : 'レースを下書きへ戻しました。',
    );
    await refresh();
  }

  async function retry(race: AdminRace, operation: 'simulation' | 'settlement'): Promise<void> {
    await apiRequest(`/api/v1/admin/races/${race.id}/retry-${operation}`, {
      method: 'POST',
      body: '{}',
    });
    setMessage(
      operation === 'simulation'
        ? 'シミュレーションの再試行を予約しました。'
        : '精算の再試行を予約しました。',
    );
    await refresh();
  }

  async function rehearseNow(race: AdminRace): Promise<void> {
    await apiRequest(`/api/v1/admin/races/${race.id}/rehearse-now`, {
      method: 'POST',
      body: '{}',
    });
    setMessage('リハーサルを精算まで進めました。');
    await refresh();
  }

  async function cancelRace(race: AdminRace, reason: string): Promise<void> {
    await apiRequest(`/api/v1/admin/races/${race.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    setCancelling(undefined);
    setMessage('レースを中止し、購入済み馬券を全額返金しました。');
    await refresh();
  }

  return (
    <div className="admin-workspace">
      <TerminalPanel heading="開催一覧" status={`${String(races.length)}件`}>
        {races.length === 0 ? (
          <div className="empty-copy">
            <strong>レースがありません</strong>
          </div>
        ) : (
          <div className="race-admin-list">
            {races.map((race) => (
              <article key={race.id}>
                <div>
                  <small>
                    {race.raceDate} / v{String(race.version)}
                  </small>
                  <h3>{race.name}</h3>
                  <p>
                    {String(race.distanceM)}m / {surfaceLabel(race.surface)} / {race.kind}
                  </p>
                  <dl className="race-operation-metrics">
                    <div>
                      <dt>正式simulation</dt>
                      <dd>{race.officialSimulationStatus ?? '未作成'}</dd>
                    </div>
                    <div>
                      <dt>オッズsimulation</dt>
                      <dd>{race.oddsSimulationStatus ?? '未作成'}</dd>
                    </div>
                    <div>
                      <dt>基準オッズ</dt>
                      <dd>{formatOddsRange(race)}</dd>
                    </div>
                    <div>
                      <dt>seed liquidity</dt>
                      <dd>{formatSeedLiquidity(race)}</dd>
                    </div>
                    <div>
                      <dt>R2 timeline</dt>
                      <dd>{race.timelineObjectKey === null ? '未保存' : '保存済み'}</dd>
                    </div>
                  </dl>
                  {entriesFor(race).some((entry) => entry.condition !== undefined) ? (
                    <p className="condition-readout">
                      調子:{' '}
                      {entriesFor(race)
                        .map(
                          (entry) =>
                            `${String(entry.horseNumber)}番 ${entry.condition ?? '未抽選'}`,
                        )
                        .join(' / ')}
                    </p>
                  ) : null}
                </div>
                <strong className="status-readout">{race.status}</strong>
                <div className="inline-actions">
                  {race.status === 'draft' ? (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setEditing(race)}
                    >
                      下書きを編集
                    </button>
                  ) : null}
                  {race.status === 'draft' ? (
                    <button type="button" onClick={() => void transition(race, 'lock')}>
                      レースを確定
                    </button>
                  ) : null}
                  {race.status === 'locked' ? (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void transition(race, 'unlock')}
                    >
                      下書きへ戻す
                    </button>
                  ) : null}
                  {['failed', 'locked', 'simulating'].includes(race.status) ? (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void retry(race, 'simulation')}
                    >
                      simulation再試行
                    </button>
                  ) : null}
                  {['finished', 'settling', 'failed'].includes(race.status) ? (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void retry(race, 'settlement')}
                    >
                      精算再試行
                    </button>
                  ) : null}
                  {race.status === 'betting_open' ? (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void rehearseNow(race)}
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
                    >
                      緊急結果閲覧
                    </button>
                  ) : null}
                  {!['settled', 'cancelled', 'running', 'finished', 'settling'].includes(
                    race.status,
                  ) ? (
                    <button
                      type="button"
                      className="button-danger"
                      onClick={() => setCancelling(race)}
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

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raceDate = String(form.get('raceDate'));
    const entries = Array.from({ length: 8 }, (_, index) => ({
      horseId: String(form.get(`horse-${String(index + 1)}`)),
      horseNumber: index + 1,
    }));
    if (new Set(entries.map((entry) => entry.horseId)).size !== 8) {
      setError('8頭すべてに異なる馬を選んでください。');
      return;
    }
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
      event.currentTarget.reset();
      setError('');
      await onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '保存できません。入力内容を確認してください。',
      );
    }
  }

  const selectedEntries = entriesFor(race);
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
            <input
              name="distanceM"
              type="number"
              min={800}
              max={5000}
              defaultValue={race?.distanceM ?? 1200}
              required
            />
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
          <legend>出走馬8頭</legend>
          {Array.from({ length: 8 }, (_, index) => (
            <label key={index}>
              {String(index + 1)}番
              <select
                name={`horse-${String(index + 1)}`}
                required
                defaultValue={selectedEntries[index]?.horseId ?? ''}
              >
                <option value="" disabled>
                  馬を選択
                </option>
                {horses.map((horse) => (
                  <option key={horse.id} value={horse.id}>
                    {horse.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
        {horses.length < 8 ? (
          <p className="field-error">レース作成には、引退していない馬が8頭必要です。</p>
        ) : null}
        {error === '' ? null : (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" disabled={horses.length < 8}>
            {race === undefined ? '下書きを保存' : '変更を保存'}
          </button>
          {race === undefined ? null : (
            <button type="button" className="button-secondary" onClick={onCancel}>
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
        onClose();
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
          <button type="button" className="button-secondary" onClick={onClose}>
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
    return parsed.filter((entry: unknown): entry is RaceEntrySelection => {
      if (typeof entry !== 'object' || entry === null) return false;
      const record = entry as Record<string, unknown>;
      return typeof record.horseId === 'string' && typeof record.horseNumber === 'number';
    });
  } catch {
    return [];
  }
}

function formatOddsRange(race: AdminRace): string {
  if (race.minimumBaseOdds === null || race.maximumBaseOdds === null) return '未生成';
  return `${race.minimumBaseOdds.toFixed(1)}–${race.maximumBaseOdds.toFixed(1)}倍 (${race.oddsSelectionCount}通り)`;
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
