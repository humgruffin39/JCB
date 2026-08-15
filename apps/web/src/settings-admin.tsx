import { gameSettingsSchema } from '@jcb/config';
import { TerminalPanel } from '@jcb/ui';
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { useAdminToast } from './admin-toaster.js';
import { apiRequest } from './api.js';
import { SettingsFormFields } from './settings-form-fields.js';
import { readSettings, requiredString } from './settings-form-model.js';
import { SettingsHistory } from './settings-history.js';
import { useAdminPolling } from './use-admin-polling.js';
import { useSubmitLock } from './use-submit-lock.js';

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
  const {
    isLocked: isSubmitting,
    lock: lockSubmission,
    unlock: unlockSubmission,
  } = useSubmitLock();
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
    if (!lockSubmission()) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
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
      unlockSubmission();
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
        <SettingsFormFields settings={data.gameSettings} />
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
      <SettingsHistory history={data.history} />
    </TerminalPanel>
  );
}
