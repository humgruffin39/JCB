import { TerminalPanel } from '@jcb/ui';
import { useRef, useState, type FormEvent } from 'react';
import { accountTypeLabel } from './admin-labels.js';
import {
  formatMoney,
  formatTimestamp,
  OperationTable,
  type OperationRow,
} from './currency-operation-table.js';
import { useSubmitLock } from './use-submit-lock.js';

export interface AdjustmentDraft {
  readonly accountId: string;
  readonly accountLabel: string;
  readonly amount: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export function CurrencyOverview({
  accounts,
  carryover,
  onConfirmAdjustment,
}: {
  readonly accounts: readonly OperationRow[];
  readonly carryover: OperationRow | null;
  readonly onConfirmAdjustment: (draft: AdjustmentDraft) => Promise<void>;
}) {
  const [adjustmentDraft, setAdjustmentDraft] = useState<AdjustmentDraft>();
  const adjustmentForm = useRef<HTMLFormElement>(null);

  function reviewAdjustment(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accountId = String(form.get('accountId'));
    const account = accounts.find((row) => String(row.id) === accountId);
    setAdjustmentDraft({
      accountId,
      accountLabel: String(account?.displayName ?? account?.ownerKey ?? accountId),
      amount: String(form.get('amount')),
      reason: String(form.get('reason')),
      idempotencyKey: `admin-adjustment:${crypto.randomUUID()}`,
    });
  }

  return (
    <div className="admin-surface-grid">
      <OperationTable
        heading="口座残高"
        rows={accounts}
        columns={[
          ['displayName', '名義'],
          ['accountType', '種別'],
          ['amount', '残高'],
          ['id', '口座ID'],
        ]}
        moneyColumns={new Set(['amount'])}
      />
      <TerminalPanel heading="残高補正">
        {adjustmentDraft === undefined ? (
          <form ref={adjustmentForm} className="terminal-form" onSubmit={reviewAdjustment}>
            <label>
              対象口座
              <select name="accountId" required defaultValue="">
                <option value="" disabled>
                  口座を選択
                </option>
                {accounts.map((account) => (
                  <option key={String(account.id)} value={String(account.id)}>
                    {String(account.displayName ?? account.ownerKey)} /{' '}
                    {accountTypeLabel(String(account.accountType))} / {formatMoney(account.amount)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              補正額
              <input name="amount" type="number" step={1} required />
              <span className="field-hint">正の値は加算、負の値は減算です。</span>
            </label>
            <label>
              理由
              <textarea name="reason" minLength={3} maxLength={300} required />
            </label>
            <div className="form-actions">
              <button type="submit" className="form-submit">
                確認する
              </button>
            </div>
          </form>
        ) : (
          <AdjustmentReview
            draft={adjustmentDraft}
            onClose={() => setAdjustmentDraft(undefined)}
            onConfirm={async (draft) => {
              await onConfirmAdjustment(draft);
              setAdjustmentDraft(undefined);
              adjustmentForm.current?.reset();
            }}
          />
        )}
      </TerminalPanel>
      <TerminalPanel heading="三連単キャリーオーバー">
        {carryover === null ? (
          <p>キャリーオーバー口座がありません。</p>
        ) : (
          <dl className="metric-list">
            <div>
              <dt>予測残高</dt>
              <dd>{formatMoney(carryover.amountProjection)}</dd>
            </div>
            <div>
              <dt>口座残高</dt>
              <dd>{formatMoney(carryover.accountBalance)}</dd>
            </div>
            <div>
              <dt>更新日時</dt>
              <dd>{formatTimestamp(carryover.updatedAt)}</dd>
            </div>
          </dl>
        )}
      </TerminalPanel>
    </div>
  );
}

function AdjustmentReview({
  draft,
  onClose,
  onConfirm,
}: {
  readonly draft: AdjustmentDraft;
  readonly onClose: () => void;
  readonly onConfirm: (draft: AdjustmentDraft) => Promise<void>;
}) {
  const {
    isLocked: isSubmitting,
    lock: lockSubmission,
    unlock: unlockSubmission,
  } = useSubmitLock();
  const [error, setError] = useState('');

  return (
    <section className="currency-adjustment-review" aria-labelledby="adjustment-review-title">
      <h3 id="adjustment-review-title">残高補正を記録しますか</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!lockSubmission()) return;
          setError('');
          void onConfirm(draft)
            .catch((caught: unknown) => {
              setError(caught instanceof Error ? caught.message : '補正取引を記録できません。');
            })
            .finally(unlockSubmission);
        }}
      >
        <dl className="metric-list">
          <div>
            <dt>対象口座</dt>
            <dd>{draft.accountLabel}</dd>
          </div>
          <div>
            <dt>補正額</dt>
            <dd>{formatMoney(draft.amount)}</dd>
          </div>
          <div>
            <dt>理由</dt>
            <dd>{draft.reason}</dd>
          </div>
        </dl>
        <p>この取引は台帳と監査ログに記録されます。</p>
        {error === '' ? null : (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="inline-actions">
          <button type="submit" className="form-submit" disabled={isSubmitting}>
            {isSubmitting ? '記録中…' : '補正を記録する'}
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
    </section>
  );
}
