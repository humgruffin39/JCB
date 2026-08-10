import { TerminalPanel } from '@jcb/ui';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AbilitySlider } from './ability-slider.js';
import { apiRequest } from './api.js';
import { PreferenceSlider } from './preference-slider.js';

interface Horse {
  readonly id: string;
  readonly name: string;
  readonly status: 'active' | 'resting' | 'retired';
  readonly runningStyle: 'front_runner' | 'closer';
  readonly coatColor: 'black' | 'chestnut' | 'gray' | 'cream';
  readonly speed: number;
  readonly start: number;
  readonly acceleration: number;
  readonly stamina: number;
  readonly lateKick: number;
  readonly conditionStability: number;
  readonly distancePreference: number;
  readonly surfacePreference: number;
}

interface HorsePerformance {
  readonly starts: number;
  readonly wins: number;
  readonly topThreeFinishes: number;
  readonly history: readonly {
    readonly raceId: string;
    readonly raceDate: string;
    readonly raceName: string;
    readonly distanceM: string;
    readonly surface: 'turf' | 'dirt';
    readonly horseNumber: string;
    readonly condition: string;
    readonly finishPosition: string | null;
    readonly finishTimeMs: string | null;
  }[];
}

type AbilityKey =
  'speed' | 'start' | 'acceleration' | 'stamina' | 'lateKick' | 'conditionStability';

const ABILITIES: readonly (readonly [AbilityKey, string])[] = [
  ['speed', 'スピード'],
  ['start', 'スタート'],
  ['acceleration', '加速'],
  ['stamina', 'スタミナ'],
  ['lateKick', 'ノビ'],
  ['conditionStability', '調子安定'],
];

const COAT_LABELS: Readonly<Record<Horse['coatColor'], string>> = {
  black: '黒',
  chestnut: '栗毛',
  gray: 'グレー',
  cream: 'クリーム',
};

export function HorseAdmin() {
  const [horses, setHorses] = useState<readonly Horse[]>([]);
  const [editing, setEditing] = useState<Horse>();
  const [performance, setPerformance] = useState<{
    readonly horse: Horse;
    readonly record: HorsePerformance;
  }>();
  const [message, setMessage] = useState('');
  const refresh = useCallback(async () => {
    setHorses(await apiRequest<readonly Horse[]>('/api/v1/admin/horses'));
  }, []);
  useEffect(() => void refresh(), [refresh]);

  return (
    <div className="admin-workspace">
      <TerminalPanel heading="登録済みの馬" status={`${String(horses.length)}頭`}>
        {horses.length === 0 ? (
          <div className="empty-copy">
            <strong>馬が登録されていません</strong>
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>馬名</th>
                  <th>状態</th>
                  <th>脚質</th>
                  <th>毛色</th>
                  <th>速度</th>
                  <th>
                    <span className="visually-hidden">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {horses.map((horse) => (
                  <tr key={horse.id}>
                    <td>{horse.name}</td>
                    <td>{horse.status}</td>
                    <td>{horse.runningStyle === 'front_runner' ? '逃げ' : '差し'}</td>
                    <td>{COAT_LABELS[horse.coatColor]}</td>
                    <td>{String(horse.speed)}</td>
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setEditing(horse)}
                        >
                          編集する
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            void apiRequest<HorsePerformance>(
                              `/api/v1/admin/horses/${horse.id}/performance`,
                            ).then((record) => setPerformance({ horse, record }));
                          }}
                        >
                          戦績を見る
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TerminalPanel>
      <HorseForm
        key={editing?.id ?? 'new-horse'}
        {...(editing === undefined ? {} : { horse: editing })}
        onSaved={async (savedMessage) => {
          setEditing(undefined);
          setMessage(savedMessage);
          await refresh();
        }}
        onCancel={() => setEditing(undefined)}
      />
      {message === '' ? null : (
        <p className="admin-message" role="status">
          {message}
        </p>
      )}
      {performance === undefined ? null : (
        <HorsePerformancePanel
          horse={performance.horse}
          record={performance.record}
          onClose={() => setPerformance(undefined)}
        />
      )}
    </div>
  );
}

function HorsePerformancePanel({
  horse,
  record,
  onClose,
}: {
  readonly horse: Horse;
  readonly record: HorsePerformance;
  readonly onClose: () => void;
}) {
  return (
    <TerminalPanel
      heading={`${horse.name}の戦績・出走履歴`}
      status={`${String(record.starts)}戦 ${String(record.wins)}勝`}
    >
      <p>
        3着以内 {String(record.topThreeFinishes)}回
        {record.starts === 0
          ? '。確定済みの出走履歴はありません。'
          : ` / 勝率 ${((record.wins / record.starts) * 100).toFixed(1)}%`}
      </p>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>開催日</th>
              <th>レース</th>
              <th>馬番</th>
              <th>調子</th>
              <th>着順</th>
              <th>タイム</th>
            </tr>
          </thead>
          <tbody>
            {record.history.map((row) => (
              <tr key={row.raceId}>
                <td>{row.raceDate}</td>
                <td>
                  {row.raceName} / {row.distanceM}m / {surfaceLabel(row.surface)}
                </td>
                <td>{row.horseNumber}</td>
                <td>{row.condition}</td>
                <td>{row.finishPosition ?? '未確定'}</td>
                <td>
                  {row.finishTimeMs === null
                    ? '—'
                    : `${(Number(row.finishTimeMs) / 1000).toFixed(3)}秒`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="button-secondary" onClick={onClose}>
        閉じる
      </button>
    </TerminalPanel>
  );
}

function HorseForm({
  horse,
  onSaved,
  onCancel,
}: {
  readonly horse?: Horse;
  readonly onSaved: (message: string) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get('name')),
      status: String(form.get('status')),
      runningStyle: String(form.get('runningStyle')),
      coatColor: String(form.get('coatColor')),
      ...Object.fromEntries(ABILITIES.map(([key]) => [key, Number(form.get(key))])),
      distancePreference: Number(form.get('distancePreference')),
      surfacePreference: Number(form.get('surfacePreference')),
    };
    try {
      await apiRequest(
        horse === undefined ? '/api/v1/admin/horses' : `/api/v1/admin/horses/${horse.id}`,
        {
          method: horse === undefined ? 'POST' : 'PATCH',
          body: JSON.stringify(payload),
        },
      );
      event.currentTarget.reset();
      await onSaved(horse === undefined ? '馬を登録しました。' : '馬の情報を更新しました。');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '保存できません。入力内容を確認してください。',
      );
    }
  }
  return (
    <TerminalPanel heading={horse === undefined ? '馬を登録' : '馬を編集'}>
      <form className="terminal-form" onSubmit={(event) => void submit(event)}>
        <div className="form-row">
          <label>
            馬名
            <input name="name" required maxLength={80} defaultValue={horse?.name ?? ''} />
          </label>
          <label>
            状態
            <select name="status" defaultValue={horse?.status ?? 'active'}>
              <option value="active">出走可</option>
              <option value="resting">休養</option>
              <option value="retired">引退</option>
            </select>
          </label>
          <label>
            脚質
            <select name="runningStyle" defaultValue={horse?.runningStyle ?? 'front_runner'}>
              <option value="front_runner">逃げ</option>
              <option value="closer">差し</option>
            </select>
          </label>
          <label>
            毛色
            <select name="coatColor" defaultValue={horse?.coatColor ?? 'chestnut'}>
              <option value="black">黒</option>
              <option value="chestnut">栗毛</option>
              <option value="gray">グレー</option>
              <option value="cream">クリーム</option>
            </select>
          </label>
        </div>
        <fieldset className="ability-group">
          <legend>基本能力</legend>
          <div className="ability-grid">
            {ABILITIES.map(([key, label]) => (
              <AbilitySlider key={key} name={key} label={label} initialValue={horse?.[key] ?? 50} />
            ))}
          </div>
        </fieldset>
        <fieldset className="ability-group">
          <legend>適性</legend>
          <div className="preference-grid">
            <PreferenceSlider
              name="distancePreference"
              label="距離"
              initialValue={horse?.distancePreference ?? 0}
            />
            <PreferenceSlider
              name="surfacePreference"
              label="コース"
              initialValue={horse?.surfacePreference ?? 0}
            />
          </div>
        </fieldset>
        {error === '' ? null : (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit">{horse === undefined ? '馬を登録' : '変更を保存'}</button>
          {horse === undefined ? null : (
            <button type="button" className="button-secondary" onClick={onCancel}>
              編集をやめる
            </button>
          )}
        </div>
      </form>
    </TerminalPanel>
  );
}

function surfaceLabel(surface: HorsePerformance['history'][number]['surface']): string {
  return surface === 'turf' ? '芝' : 'ダート';
}
