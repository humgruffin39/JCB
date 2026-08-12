import { TerminalPanel } from '@jcb/ui';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  accountTypeLabel,
  betStatusLabel,
  poolTypeLabel,
  referenceTypeLabel,
} from './admin-labels.js';
import { useAdminToast } from './admin-toaster.js';
import { apiRequest } from './api.js';
import { useAdminPolling } from './use-admin-polling.js';

type OperationRow = Readonly<Record<string, string | number | null>>;

interface EconomyOperations {
  readonly accounts: readonly OperationRow[];
  readonly bets: readonly OperationRow[];
  readonly settlements: readonly OperationRow[];
  readonly carryover: OperationRow | null;
  readonly seedPositions: readonly OperationRow[];
  readonly relief: readonly OperationRow[];
}

interface AdjustmentDraft {
  readonly accountId: string;
  readonly accountLabel: string;
  readonly amount: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

type CurrencySection = 'overview' | 'bets' | 'settlements' | 'profit-loss' | 'ledger';

export function CurrencyAdmin() {
  const [economy, setEconomy] = useState<EconomyOperations>();
  const [ledger, setLedger] = useState<readonly OperationRow[]>([]);
  const [error, setError] = useState('');
  const [adjustmentDraft, setAdjustmentDraft] = useState<AdjustmentDraft>();
  const [section, setSection] = useState<CurrencySection>('overview');
  const previousSection = useRef(section);
  const adjustmentForm = useRef<HTMLFormElement>(null);
  const { success } = useAdminToast();

  const refresh = useCallback(async () => {
    if (section === 'ledger') {
      setLedger(await apiRequest<readonly OperationRow[]>('/api/v1/admin/ledger'));
      return;
    }
    setEconomy(await apiRequest<EconomyOperations>('/api/v1/admin/economy'));
  }, [section]);

  const { error: refreshError, isInitialLoading, refreshNow } = useAdminPolling(refresh, 7_500);

  useEffect(() => {
    if (previousSection.current === section) return;
    previousSection.current = section;
    void refreshNow().catch(() => undefined);
  }, [refreshNow, section]);

  function adjust(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const accountId = String(form.get('accountId'));
    const account = economy?.accounts.find((row) => String(row.id) === accountId);
    setAdjustmentDraft({
      accountId,
      accountLabel: String(account?.displayName ?? account?.ownerKey ?? accountId),
      amount: String(form.get('amount')),
      reason: String(form.get('reason')),
      idempotencyKey: `admin-adjustment:${crypto.randomUUID()}`,
    });
  }

  async function confirmAdjustment(draft: AdjustmentDraft): Promise<void> {
    await apiRequest('/api/v1/admin/ledger/adjustments', {
      method: 'POST',
      body: JSON.stringify({
        accountId: draft.accountId,
        amount: draft.amount,
        reason: draft.reason,
        idempotencyKey: draft.idempotencyKey,
      }),
    });
    setAdjustmentDraft(undefined);
    adjustmentForm.current?.reset();
    success('残高を補正しました。');
    try {
      await refreshNow();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '補正後の残高を更新できません。');
    }
  }

  if (economy === undefined) {
    return (
      <div className="admin-page">
        <TerminalPanel heading="通貨データ" status="読み込み中">
          {refreshError === undefined ? null : (
            <p className="field-error" role="alert">
              {refreshError} 通貨データを取得できません。時間をおいて再確認してください。
            </p>
          )}
          <p role="status" aria-live="polite">
            {isInitialLoading ? '通貨データを読み込んでいます。' : '通貨データを表示できません。'}
          </p>
        </TerminalPanel>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <nav className="admin-subnav" aria-label="通貨管理メニュー" role="tablist">
        {(
          [
            ['overview', '概要'],
            ['bets', '馬券'],
            ['settlements', '精算・給付'],
            ['profit-loss', '損益'],
            ['ledger', '台帳'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            id={`currency-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={section === value}
            aria-controls="currency-panel"
            onClick={() => setSection(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {refreshError === undefined ? null : (
        <p className="field-error" role="alert">
          {refreshError} 通貨データを更新できません。
        </p>
      )}
      <div
        id="currency-panel"
        role="tabpanel"
        aria-labelledby={`currency-tab-${section}`}
        tabIndex={0}
      >
        {section === 'overview' ? (
          <div className="admin-surface-grid">
            <OperationTable
              heading="口座残高"
              rows={economy.accounts}
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
                <form ref={adjustmentForm} className="terminal-form" onSubmit={adjust}>
                  <label>
                    対象口座
                    <select name="accountId" required defaultValue="">
                      <option value="" disabled>
                        口座を選択
                      </option>
                      {economy.accounts.map((account) => (
                        <option key={String(account.id)} value={String(account.id)}>
                          {String(account.displayName ?? account.ownerKey)} /{' '}
                          {accountTypeLabel(String(account.accountType))} /{' '}
                          {formatMoney(account.amount)}
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
                  {error === '' ? null : (
                    <p className="field-error" role="alert">
                      {error}
                    </p>
                  )}
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
                  onConfirm={confirmAdjustment}
                />
              )}
            </TerminalPanel>
            <TerminalPanel heading="三連単キャリーオーバー">
              {economy.carryover === null ? (
                <p>キャリーオーバー口座がありません。</p>
              ) : (
                <dl className="metric-list">
                  <div>
                    <dt>予測残高</dt>
                    <dd>{formatMoney(economy.carryover.amountProjection)}</dd>
                  </div>
                  <div>
                    <dt>口座残高</dt>
                    <dd>{formatMoney(economy.carryover.accountBalance)}</dd>
                  </div>
                  <div>
                    <dt>更新日時</dt>
                    <dd>{formatTimestamp(economy.carryover.updatedAt)}</dd>
                  </div>
                </dl>
              )}
            </TerminalPanel>
          </div>
        ) : section === 'bets' ? (
          <OperationTable
            heading="馬券履歴"
            rows={economy.bets}
            columns={[
              ['raceDate', '開催日'],
              ['raceName', 'レース'],
              ['displayName', '購入者'],
              ['poolType', '券種'],
              ['selectionCode', '買い目'],
              ['stake', '賭け金'],
              ['status', '状態'],
              ['payout', '払戻'],
            ]}
            moneyColumns={new Set(['stake', 'payout'])}
          />
        ) : section === 'settlements' ? (
          <div className="admin-surface-grid">
            <OperationTable
              heading="精算・返金履歴"
              rows={economy.settlements}
              columns={[
                ['createdAt', '記録時刻'],
                ['kind', '種別'],
                ['referenceType', '参照'],
                ['referenceId', '参照ID'],
                ['description', '説明'],
              ]}
            />
            <OperationTable
              heading="救済給付"
              rows={economy.relief}
              columns={[
                ['createdAt', '記録時刻'],
                ['displayName', '受給者'],
                ['amount', '給付額'],
                ['transactionId', '取引ID'],
              ]}
              moneyColumns={new Set(['amount'])}
            />
          </div>
        ) : section === 'profit-loss' ? (
          <OperationTable
            heading="初期流動性の損益"
            rows={economy.seedPositions}
            columns={[
              ['raceDate', '開催日'],
              ['raceName', 'レース'],
              ['poolType', '券種'],
              ['selectionCode', '買い目'],
              ['stake', '初期資金'],
              ['payout', '払戻'],
              ['profitLoss', '損益'],
            ]}
            moneyColumns={new Set(['stake', 'payout', 'profitLoss'])}
          />
        ) : (
          <OperationTable
            heading="台帳明細"
            rows={ledger}
            columns={[
              ['createdAt', '記録時刻'],
              ['kind', '種別'],
              ['accountId', '口座ID'],
              ['amount', '増減'],
              ['transactionId', '取引ID'],
            ]}
            moneyColumns={new Set(['amount'])}
          />
        )}
      </div>
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  return (
    <section className="currency-adjustment-review" aria-labelledby="adjustment-review-title">
      <h3 id="adjustment-review-title">残高補正を記録しますか</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setIsSubmitting(true);
          setError('');
          void onConfirm(draft)
            .catch((caught: unknown) => {
              setError(caught instanceof Error ? caught.message : '補正取引を記録できません。');
            })
            .finally(() => setIsSubmitting(false));
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

function OperationTable({
  heading,
  rows,
  columns,
  moneyColumns = new Set<string>(),
}: {
  readonly heading: string;
  readonly rows: readonly OperationRow[];
  readonly columns: readonly (readonly [string, string])[];
  readonly moneyColumns?: ReadonlySet<string>;
}) {
  return (
    <TerminalPanel heading={heading} status={`${String(rows.length)}件`}>
      <div className="data-table-wrap">
        <table className="data-table">
          <caption className="visually-hidden">{heading}</caption>
          <thead>
            <tr>
              {columns.map(([key, label]) => (
                <th key={key} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={String(row.id ?? row.transactionId ?? `${heading}-${String(index)}`)}>
                {columns.map(([key]) => (
                  <td key={key}>{formatOperationValue(key, row[key], moneyColumns)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TerminalPanel>
  );
}

function formatOperationValue(
  key: string,
  value: string | number | null | undefined,
  moneyColumns: ReadonlySet<string>,
): string {
  if (moneyColumns.has(key)) return formatMoney(value);
  if (key.toLowerCase().endsWith('at')) return formatTimestamp(value);
  if (key === 'accountType') return accountTypeLabel(String(value ?? ''));
  if (key === 'poolType') return poolTypeLabel(String(value ?? ''));
  if (key === 'referenceType') return referenceTypeLabel(String(value ?? ''));
  if (key === 'status') return betStatusLabel(String(value ?? ''));
  if (key === 'kind') return transactionKindLabel(String(value ?? ''));
  return String(value ?? '—');
}

function transactionKindLabel(kind: string): string {
  const labels: Readonly<Record<string, string>> = {
    bet_purchase: '馬券購入',
    settlement: '精算',
    relief: '救済給付',
    adjustment: '管理者補正',
    issuance: '発行',
    burn: '償却',
  };
  return labels[kind] ?? 'その他の取引';
}

function formatMoney(value: string | number | null | undefined): string {
  const text = String(value ?? '');
  return /^-?\d+$/.test(text) ? `${BigInt(text).toLocaleString('ja-JP')} R` : '—';
}

function formatTimestamp(value: string | number | null | undefined): string {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? new Date(milliseconds).toLocaleString('ja-JP')
    : '—';
}
