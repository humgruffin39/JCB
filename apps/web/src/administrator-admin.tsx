import { TerminalPanel } from '@jcb/ui';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { apiRequest } from './api.js';

const administratorSchema = z.object({
  discordUserId: z.string().regex(/^\d{5,25}$/),
  createdAt: z.string().regex(/^\d+$/),
});

export function AdministratorAdmin() {
  const [administrators, setAdministrators] = useState<
    readonly z.infer<typeof administratorSchema>[]
  >([]);
  const [error, setError] = useState('');
  const [removalTarget, setRemovalTarget] = useState<string>();
  const refresh = useCallback(async () => {
    setAdministrators(
      administratorSchema.array().parse(await apiRequest<unknown>('/api/v1/admin/administrators')),
    );
  }, []);
  useEffect(() => void refresh(), [refresh]);

  async function add(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      await apiRequest('/api/v1/admin/administrators', {
        method: 'POST',
        body: JSON.stringify({
          discordUserId: field(form, 'discordUserId'),
          reason: field(form, 'reason'),
        }),
      });
      element.reset();
      setError('');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '管理者を追加できません。');
    }
  }

  async function remove(discordUserId: string, reason: string): Promise<void> {
    try {
      await apiRequest(`/api/v1/admin/administrators/${encodeURIComponent(discordUserId)}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      });
      setError('');
      setRemovalTarget(undefined);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '管理者を削除できません。');
    }
  }

  return (
    <TerminalPanel heading="管理者許可リスト" status={`${String(administrators.length)}人`}>
      <ul className="ticket-list">
        {administrators.map((administrator) => (
          <li key={administrator.discordUserId}>
            <span>{administrator.discordUserId}</span>
            <small>{formatDate(administrator.createdAt)}</small>
            <button
              type="button"
              className="text-button"
              onClick={() => setRemovalTarget(administrator.discordUserId)}
              disabled={administrators.length <= 1}
            >
              許可を外す
            </button>
          </li>
        ))}
      </ul>
      <form className="terminal-form" onSubmit={(event) => void add(event)}>
        <div className="form-row">
          <label>
            Discord user ID
            <input name="discordUserId" inputMode="numeric" pattern="\d{5,25}" required />
          </label>
          <label>
            追加理由
            <input name="reason" minLength={5} maxLength={300} required />
          </label>
        </div>
        {error === '' ? null : (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit">管理者を追加</button>
      </form>
      {removalTarget === undefined ? null : (
        <AdministratorRemovalDialog
          discordUserId={removalTarget}
          onClose={() => setRemovalTarget(undefined)}
          onConfirm={remove}
        />
      )}
    </TerminalPanel>
  );
}

function AdministratorRemovalDialog({
  discordUserId,
  onClose,
  onConfirm,
}: {
  readonly discordUserId: string;
  readonly onClose: () => void;
  readonly onConfirm: (discordUserId: string, reason: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="confirmation-dialog"
      aria-labelledby="remove-admin-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setIsSubmitting(true);
          void onConfirm(discordUserId, reason.trim()).finally(() => setIsSubmitting(false));
        }}
      >
        <h2 id="remove-admin-title">管理者権限を外しますか</h2>
        <p>{discordUserId} は次のリクエストから管理画面を利用できなくなります。</p>
        <label>
          削除理由
          <textarea
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            minLength={5}
            maxLength={300}
            autoFocus
            required
          />
        </label>
        <div className="inline-actions">
          <button type="submit" className="button-danger" disabled={isSubmitting}>
            権限を外す
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

function field(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== 'string') throw new Error(`${key} がありません。`);
  return value.trim();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'medium',
  }).format(new Date(Number(value)));
}
