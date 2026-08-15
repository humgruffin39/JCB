import { useState, type FormEvent } from 'react';
import { AbilitySlider } from './ability-slider.js';
import { AdminDialog } from './admin-dialog.js';
import { apiRequest } from './api.js';
import type { Horse } from './horse-admin-model.js';
import { PreferenceSlider } from './preference-slider.js';
import { useSubmitLock } from './use-submit-lock.js';

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

export function HorseAdminForm({
  horse,
  onSaved,
  onCancel,
  returnFocusRef,
}: {
  readonly horse?: Horse;
  readonly onSaved: (message: string) => Promise<void>;
  readonly onCancel: () => void;
  readonly returnFocusRef: { readonly current: HTMLElement | null };
}) {
  const [error, setError] = useState('');
  const {
    isLocked: isSubmitting,
    lock: lockSubmission,
    unlock: unlockSubmission,
  } = useSubmitLock();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!lockSubmission()) return;
    setError('');
    try {
      await submitHorseAdminForm(event, {
        ...(horse === undefined ? {} : { horse }),
        onSaved,
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '保存できません。入力内容を確認してください。',
      );
    } finally {
      unlockSubmission();
    }
  }

  return (
    <AdminDialog
      title={horse === undefined ? '馬を登録' : '馬を編集'}
      onCancel={onCancel}
      returnFocusRef={returnFocusRef}
      canCancel={!isSubmitting}
    >
      <form
        className="terminal-form"
        aria-busy={isSubmitting}
        onSubmit={(event) => void submit(event)}
      >
        <div className="form-row">
          <label>
            馬名
            <input name="name" required maxLength={80} defaultValue={horse?.name ?? ''} />
          </label>
          <label>
            状態
            <select name="status" defaultValue={horse?.status ?? 'active'}>
              <option value="active">出走可</option>
              <option value="resting">休養中</option>
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
              label="距離適性"
              initialValue={horse?.distancePreference ?? 0}
            />
            <PreferenceSlider
              name="surfacePreference"
              label="コース適性"
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
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '保存中…' : horse === undefined ? '馬を登録' : '変更を保存'}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            キャンセル
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}

export async function submitHorseAdminForm(
  event: Pick<FormEvent<HTMLFormElement>, 'currentTarget'>,
  input: {
    readonly horse?: Horse;
    readonly onSaved: (message: string) => Promise<void>;
    readonly request?: (path: string, init?: RequestInit) => Promise<unknown>;
    readonly readForm?: (form: HTMLFormElement) => FormData;
  },
): Promise<void> {
  // React clears currentTarget after the synchronous event handler returns.
  // Keep the element itself, not the event, across the network await.
  const formElement = event.currentTarget;
  const form = input.readForm?.(formElement) ?? new FormData(formElement);
  const payload = {
    name: String(form.get('name')),
    status: String(form.get('status')),
    runningStyle: String(form.get('runningStyle')),
    coatColor: String(form.get('coatColor')),
    ...Object.fromEntries(ABILITIES.map(([key]) => [key, Number(form.get(key))])),
    distancePreference: Number(form.get('distancePreference')),
    surfacePreference: Number(form.get('surfacePreference')),
  };
  await (input.request ?? apiRequest)(
    input.horse === undefined ? '/api/v1/admin/horses' : `/api/v1/admin/horses/${input.horse.id}`,
    {
      method: input.horse === undefined ? 'POST' : 'PATCH',
      body: JSON.stringify(payload),
    },
  );
  formElement.reset();
  await input.onSaved(
    input.horse === undefined ? '馬を登録しました。' : '馬の情報を更新しました。',
  );
}
