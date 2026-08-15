import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiAbsoluteUrl, apiRequest } from './api.js';
import type { AdminRace } from './race-admin-model.js';
import { useSubmitLock } from './use-submit-lock.js';

export interface CancellationDialogProps {
  readonly race: AdminRace;
  readonly onClose: () => void;
  readonly onConfirm: (race: AdminRace, reason: string) => Promise<void>;
}

export function CancellationDialog({ race, onClose, onConfirm }: CancellationDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const {
    isLocked: isSubmitting,
    lock: lockSubmission,
    unlock: unlockSubmission,
  } = useSubmitLock();
  const [error, setError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!lockSubmission()) return;
    try {
      await onConfirm(race, reason.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'レースを中止できません。');
    } finally {
      unlockSubmission();
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
      <form onSubmit={(event) => void submit(event)}>
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

export interface RehearsalDialogProps {
  readonly race: AdminRace;
  readonly onClose: () => void;
  readonly onConfirm: (race: AdminRace) => Promise<void>;
}

export function RehearsalDialog({ race, onClose, onConfirm }: RehearsalDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const {
    isLocked: isSubmitting,
    lock: lockSubmission,
    unlock: unlockSubmission,
  } = useSubmitLock();
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
          if (!lockSubmission()) return;
          setError('');
          void onConfirm(race)
            .catch((caught: unknown) => {
              setError(caught instanceof Error ? caught.message : '今すぐ進行できません。');
            })
            .finally(unlockSubmission);
        }}
      >
        <h2 id="rehearse-race-title">「{race.name}」を今すぐ進行しますか</h2>
        <p>観戦画面をすぐに公開し、1分後に発走します。レース終了後に自動で精算します。</p>
        {error === '' ? null : (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="inline-actions">
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '処理中…' : '今すぐ進行'}
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

export interface EmergencyRevealDialogProps {
  readonly race: AdminRace;
  readonly onClose: () => void;
}

export function EmergencyRevealDialog({ race, onClose }: EmergencyRevealDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState('');
  const {
    isLocked: isSubmitting,
    lock: lockSubmission,
    unlock: unlockSubmission,
  } = useSubmitLock();

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  async function reveal(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!lockSubmission()) return;
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
      unlockSubmission();
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
