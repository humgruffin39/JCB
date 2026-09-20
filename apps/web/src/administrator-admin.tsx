import { TerminalPanel } from '@jcb/ui';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { AddIcon, RemoveIcon } from './admin-icons.js';
import { useAdminToast } from './admin-toaster.js';
import { apiRequest } from './api.js';
import { useAdminPolling } from './use-admin-polling.js';
import { useSubmitLock } from './use-submit-lock.js';

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
  const { isLocked: isAdding, lock: lockAdding, unlock: unlockAdding } = useSubmitLock();
  const { success } = useAdminToast();
  const refresh = useCallback(async () => {
    setAdministrators(
      administratorSchema.array().parse(await apiRequest<unknown>('/api/v1/admin/administrators')),
    );
  }, []);
  const { error: refreshError, isInitialLoading, refreshNow } = useAdminPolling(refresh, 15_000);

  async function add(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!lockAdding()) return;
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
      success('管理者を追加しました。');
      try {
        await refreshNow();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? `管理者は追加されましたが、一覧を更新できませんでした。${caught.message}`
            : '管理者は追加されましたが、一覧を更新できませんでした。',
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '管理者を追加できません。');
    } finally {
      unlockAdding();
    }
  }

  async function remove(discordUserId: string, reason: string): Promise<void> {
    try {
      await apiRequest(`/api/v1/admin/administrators/${encodeURIComponent(discordUserId)}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      });
      setError('');
      success('管理者権限を外しました。');
      setRemovalTarget(undefined);
      try {
        await refreshNow();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? `権限は変更されましたが、一覧を更新できませんでした。${caught.message}`
            : '権限は変更されましたが、一覧を更新できませんでした。',
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '管理者を削除できません。');
    }
  }

  return (
    <div className="admin-surface-grid">
      <TerminalPanel heading="管理者" status={`${String(administrators.length)}人`}>
        {refreshError === undefined ? null : (
          <p className="field-error" role="alert">
            {refreshError} 管理者一覧を更新できません。
          </p>
        )}
        {isInitialLoading ? null : administrators.length === 0 ? (
          <p className="empty-copy" role="status">
            管理者が登録されていません。
          </p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table data-table--actions">
              <caption className="visually-hidden">管理者</caption>
              <thead>
                <tr>
                  <th scope="col">DiscordユーザーID</th>
                  <th scope="col">登録日</th>
                  <th scope="col">
                    <span className="visually-hidden">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {administrators.map((administrator) => (
                  <tr key={administrator.discordUserId}>
                    <td className="numeric">{administrator.discordUserId}</td>
                    <td>{formatDate(administrator.createdAt)}</td>
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="text-button button-danger"
                          onClick={() => setRemovalTarget(administrator.discordUserId)}
                          disabled={administrators.length <= 1}
                          aria-label={`${administrator.discordUserId}の権限を外す`}
                        >
                          <RemoveIcon size={13} ariaHidden />
                          権限を外す
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

      <TerminalPanel heading="管理者を追加">
        <form className="terminal-form" aria-busy={isAdding} onSubmit={(event) => void add(event)}>
          <label>
            DiscordユーザーID
            <input
              name="discordUserId"
              inputMode="numeric"
              pattern="\d{5,25}"
              placeholder="000000000000000000"
              required
            />
          </label>
          <label>
            追加理由
            <input name="reason" minLength={5} maxLength={300} required />
          </label>
          {error === '' ? null : (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="form-submit" disabled={isAdding}>
              <AddIcon size={14} ariaHidden />
              {isAdding ? '追加中…' : '管理者を追加'}
            </button>
          </div>
        </form>
      </TerminalPanel>

      {removalTarget === undefined ? null : (
        <AdministratorRemovalDialog
          discordUserId={removalTarget}
          onClose={() => setRemovalTarget(undefined)}
          onConfirm={remove}
        />
      )}
    </div>
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
  const {
    isLocked: isSubmitting,
    lock: lockSubmission,
    unlock: unlockSubmission,
  } = useSubmitLock();
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
          if (!lockSubmission()) return;
          void onConfirm(discordUserId, reason.trim()).finally(unlockSubmission);
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
          <button type="submit" className="button-danger form-submit" disabled={isSubmitting}>
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
