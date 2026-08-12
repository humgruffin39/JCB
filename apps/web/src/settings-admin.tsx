import { gameSettingsSchema, type GameSettings } from '@jcb/config';
import { TerminalPanel } from '@jcb/ui';
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { useAdminToast } from './admin-toaster.js';
import { apiRequest } from './api.js';
import { useAdminPolling } from './use-admin-polling.js';

const responseSchema = z.object({
  gameSettings: gameSettingsSchema,
  history: z.array(
    z.object({
      id: z.string(),
      value: gameSettingsSchema,
      updatedByUserId: z.string().nullable(),
      updatedAt: z.string(),
    }),
  ),
});

type SettingsResponse = z.infer<typeof responseSchema>;

export function SettingsAdmin() {
  const [data, setData] = useState<SettingsResponse>();
  const [error, setError] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formDirty = useRef(false);
  const { success } = useAdminToast();
  const refresh = useCallback(async () => {
    const parsed = responseSchema.parse(await apiRequest<unknown>('/api/v1/admin/settings'));
    setData(parsed);
    if (!formDirty.current) setFormKey((current) => current + 1);
  }, []);

  const { error: refreshError, refreshNow } = useAdminPolling(refresh, 10_000);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setIsSubmitting(true);
    try {
      const settings = readSettings(form, data?.gameSettings);
      const reason = requiredString(form, 'reason');
      await apiRequest('/api/v1/admin/settings/game', {
        method: 'PUT',
        body: JSON.stringify({ settings, reason }),
      });
      setError('');
      success('設定を保存しました。');
      formDirty.current = false;
      formElement.reset();
      try {
        await refreshNow();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? `設定は保存されましたが、履歴を更新できませんでした。${caught.message}`
            : '設定は保存されましたが、履歴を更新できませんでした。',
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : '設定を保存できません。入力内容を確認してください。',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (data === undefined) {
    return (
      <TerminalPanel heading="運用設定" status="読み込み中">
        {refreshError === undefined ? null : (
          <p className="field-error" role="alert">
            {refreshError} 設定を更新できません。
          </p>
        )}
        <p aria-live="polite">設定履歴を読み込んでいます。</p>
      </TerminalPanel>
    );
  }

  const settings = data.gameSettings;
  return (
    <TerminalPanel heading="運用設定" status={`${String(data.history.length)}件の変更履歴`}>
      {refreshError === undefined ? null : (
        <p className="field-error" role="alert">
          {refreshError} 設定履歴を更新できません。
        </p>
      )}
      <form
        key={formKey}
        className="terminal-form settings-form"
        aria-busy={isSubmitting}
        onInput={() => {
          formDirty.current = true;
        }}
        onSubmit={(event) => void submit(event)}
      >
        <fieldset>
          <legend>標準スケジュール（JST）</legend>
          <div className="form-row">
            <TimeField
              name="missingRaceWarningTime"
              label="未作成警告"
              value={settings.missingRaceWarningTime}
            />
            <TimeField
              name="recommendedLockTime"
              label="確定推奨"
              value={settings.recommendedLockTime}
            />
            <TimeField name="viewerOpenTime" label="観戦開始" value={settings.viewerOpenTime} />
            <TimeField name="bettingCloseTime" label="馬券締切" value={settings.bettingCloseTime} />
            <TimeField name="startTime" label="発走" value={settings.startTime} />
          </div>
        </fieldset>

        <fieldset>
          <legend>調子抽選（合計100%）</legend>
          <div className="form-row">
            {(
              [
                ['terrible', '絶不調'],
                ['poor', '不調'],
                ['normal', '普通'],
                ['good', '好調'],
                ['excellent', '絶好調'],
              ] as const
            ).map(([name, label]) => (
              <label key={name}>
                {label}
                <input
                  name={`condition.${name}`}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={settings.conditionProbabilities[name] * 100}
                  required
                />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>更新・運用</legend>
          <div className="form-row">
            <NumberField
              name="discordOddsUpdateMilliseconds"
              label="Discordのオッズ更新間隔（秒）"
              value={settings.discordOddsUpdateMilliseconds / 1_000}
              min={10}
              max={120}
            />
            <NumberField
              name="webOddsPollMilliseconds"
              label="Webのオッズ更新間隔（秒）"
              value={settings.webOddsPollMilliseconds / 1_000}
              min={5}
              max={60}
            />
            <NumberField
              name="backupRetentionDays"
              label="バックアップ保持（日・次回再起動時）"
              value={settings.backupRetentionDays}
              min={1}
              max={90}
            />
            <NumberField
              name="visualEffectStrength"
              label="演出強度"
              value={settings.visualEffectStrength}
              min={0}
              max={1}
              step={0.1}
            />
            <NumberField
              name="soundVolume"
              label="音量初期値"
              value={settings.soundVolume}
              min={0}
              max={1}
              step={0.1}
            />
            <NumberField
              name="raceBetLimits.regular"
              label="通常レース購入上限"
              value={settings.raceBetLimits.regular}
              min={100}
              max={1_000_000}
            />
            <NumberField
              name="raceBetLimits.midweek"
              label="平日レース購入上限"
              value={settings.raceBetLimits.midweek}
              min={100}
              max={1_000_000}
            />
            <NumberField
              name="raceBetLimits.saturday_night"
              label="土曜夜購入上限"
              value={settings.raceBetLimits.saturday_night}
              min={100}
              max={1_000_000}
            />
          </div>
        </fieldset>

        <fieldset>
          <legend>初期流動性の範囲</legend>
          <div className="form-row">
            <NumberField
              name="seed.regular.winMinimum"
              label="通常・単勝 最小"
              value={settings.seedLiquidityClamp.regular.winMinimum}
              min={0}
              max={1_000_000}
            />
            <NumberField
              name="seed.regular.winMaximum"
              label="通常・単勝 最大"
              value={settings.seedLiquidityClamp.regular.winMaximum}
              min={0}
              max={1_000_000}
            />
            <NumberField
              name="seed.regular.trifectaMinimum"
              label="通常・三連単 最小"
              value={settings.seedLiquidityClamp.regular.trifectaMinimum}
              min={0}
              max={1_000_000}
            />
            <NumberField
              name="seed.regular.trifectaMaximum"
              label="通常・三連単 最大"
              value={settings.seedLiquidityClamp.regular.trifectaMaximum}
              min={0}
              max={1_000_000}
            />
            <NumberField
              name="seed.special.winMinimum"
              label="特別・単勝 最小"
              value={settings.seedLiquidityClamp.special.winMinimum}
              min={0}
              max={1_000_000}
            />
            <NumberField
              name="seed.special.winMaximum"
              label="特別・単勝 最大"
              value={settings.seedLiquidityClamp.special.winMaximum}
              min={0}
              max={1_000_000}
            />
            <NumberField
              name="seed.special.trifectaMinimum"
              label="特別・三連単 最小"
              value={settings.seedLiquidityClamp.special.trifectaMinimum}
              min={0}
              max={1_000_000}
            />
            <NumberField
              name="seed.special.trifectaMaximum"
              label="特別・三連単 最大"
              value={settings.seedLiquidityClamp.special.trifectaMaximum}
              min={0}
              max={1_000_000}
            />
          </div>
        </fieldset>

        <fieldset>
          <legend>シミュレーション設定</legend>
          <div className="form-row">
            <NumberField
              name="simulationNoiseStandardDeviation"
              label="揺らぎ標準偏差"
              value={settings.simulationNoiseStandardDeviation}
              min={0}
              max={0.1}
              step={0.001}
            />
            <NumberField
              name="fatigueMaximum"
              label="最大疲労補正"
              value={settings.fatigueMaximum}
              min={0}
              max={0.3}
              step={0.01}
            />
          </div>
        </fieldset>

        <label>
          変更理由
          <textarea name="reason" minLength={5} maxLength={300} required />
        </label>
        {error === '' ? null : (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="form-submit" disabled={isSubmitting}>
          {isSubmitting ? '保存中…' : '設定を保存'}
        </button>
      </form>

      <details>
        <summary>変更履歴（{String(data.history.length)}件）</summary>
        {data.history.length === 0 ? (
          <p className="empty-copy">変更履歴はまだありません。</p>
        ) : (
          <ol className="audit-list">
            {data.history.slice(0, 20).map((history) => (
              <li key={history.id}>
                <time>{formatTimestamp(history.updatedAt)}</time>
                <strong>運用設定を更新</strong>
                <small>{history.updatedByUserId ?? 'システム'}</small>
              </li>
            ))}
          </ol>
        )}
      </details>
    </TerminalPanel>
  );
}

function TimeField(input: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <label>
      {input.label}
      <input name={input.name} type="time" step={1} defaultValue={input.value} required />
    </label>
  );
}

function NumberField(input: {
  readonly name: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
}) {
  return (
    <label>
      {input.label}
      <input
        name={input.name}
        type="number"
        min={input.min}
        max={input.max}
        step={input.step ?? 1}
        defaultValue={input.value}
        required
      />
    </label>
  );
}

function readSettings(form: FormData, current: GameSettings | undefined): GameSettings {
  if (current === undefined) throw new Error('Current settings are unavailable.');
  return gameSettingsSchema.parse({
    missingRaceWarningTime: requiredString(form, 'missingRaceWarningTime'),
    recommendedLockTime: requiredString(form, 'recommendedLockTime'),
    viewerOpenTime: requiredString(form, 'viewerOpenTime'),
    bettingCloseTime: requiredString(form, 'bettingCloseTime'),
    startTime: requiredString(form, 'startTime'),
    conditionProbabilities: {
      terrible: requiredNumber(form, 'condition.terrible') / 100,
      poor: requiredNumber(form, 'condition.poor') / 100,
      normal: requiredNumber(form, 'condition.normal') / 100,
      good: requiredNumber(form, 'condition.good') / 100,
      excellent: requiredNumber(form, 'condition.excellent') / 100,
    },
    simulationNoiseStandardDeviation: requiredNumber(form, 'simulationNoiseStandardDeviation'),
    fatigueMaximum: requiredNumber(form, 'fatigueMaximum'),
    seedLiquidityClamp: {
      regular: {
        winMinimum: requiredNumber(form, 'seed.regular.winMinimum'),
        winMaximum: requiredNumber(form, 'seed.regular.winMaximum'),
        trifectaMinimum: requiredNumber(form, 'seed.regular.trifectaMinimum'),
        trifectaMaximum: requiredNumber(form, 'seed.regular.trifectaMaximum'),
      },
      special: {
        winMinimum: requiredNumber(form, 'seed.special.winMinimum'),
        winMaximum: requiredNumber(form, 'seed.special.winMaximum'),
        trifectaMinimum: requiredNumber(form, 'seed.special.trifectaMinimum'),
        trifectaMaximum: requiredNumber(form, 'seed.special.trifectaMaximum'),
      },
    },
    raceBetLimits: {
      regular: requiredNumber(form, 'raceBetLimits.regular'),
      midweek: requiredNumber(form, 'raceBetLimits.midweek'),
      saturday_night: requiredNumber(form, 'raceBetLimits.saturday_night'),
    },
    discordOddsUpdateMilliseconds: requiredNumber(form, 'discordOddsUpdateMilliseconds') * 1_000,
    webOddsPollMilliseconds: requiredNumber(form, 'webOddsPollMilliseconds') * 1_000,
    backupRetentionDays: requiredNumber(form, 'backupRetentionDays'),
    visualEffectStrength: requiredNumber(form, 'visualEffectStrength'),
    soundVolume: requiredNumber(form, 'soundVolume'),
  });
}

function requiredString(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} を入力してください。`);
  }
  return value.trim();
}

function requiredNumber(form: FormData, key: string): number {
  const value = Number(requiredString(form, key));
  if (!Number.isFinite(value)) throw new Error(`${key} は数値で入力してください。`);
  return value;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(Number(value)));
}
