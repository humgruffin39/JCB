import { TerminalPanel } from '@jcb/ui';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiRequest } from './api.js';

type OperationRow = Readonly<Record<string, string | number | null>>;

interface EconomyOperations {
  readonly accounts: readonly OperationRow[];
  readonly bets: readonly OperationRow[];
  readonly settlements: readonly OperationRow[];
  readonly carryover: OperationRow | null;
  readonly seedPositions: readonly OperationRow[];
  readonly relief: readonly OperationRow[];
}

export function CurrencyAdmin() {
  const [economy, setEconomy] = useState<EconomyOperations>();
  const [ledger, setLedger] = useState<readonly OperationRow[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const [nextEconomy, nextLedger] = await Promise.all([
      apiRequest<EconomyOperations>('/api/v1/admin/economy'),
      apiRequest<readonly OperationRow[]>('/api/v1/admin/ledger'),
    ]);
    setEconomy(nextEconomy);
    setLedger(nextLedger);
  }, []);

  useEffect(() => void refresh(), [refresh]);

  async function adjust(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest('/api/v1/admin/ledger/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          accountId: String(form.get('accountId')),
          amount: String(form.get('amount')),
          reason: String(form.get('reason')),
          idempotencyKey: `admin-adjustment:${crypto.randomUUID()}`,
        }),
      });
      event.currentTarget.reset();
      setMessage('中央銀行との複式台帳取引で残高を補正しました。');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '残高を補正できません。');
    }
  }

  if (economy === undefined) {
    return <p role="status">通貨データを読み込んでいます。</p>;
  }

  return (
    <div className="system-layout">
      <TerminalPanel heading="管理者補正" status="複式台帳">
        <form className="terminal-form" onSubmit={(event) => void adjust(event)}>
          <label>
            対象口座
            <select name="accountId" required defaultValue="">
              <option value="" disabled>
                口座を選択
              </option>
              {economy.accounts.map((account) => (
                <option key={String(account.id)} value={String(account.id)}>
                  {String(account.displayName ?? account.ownerKey)} / {String(account.accountType)}{' '}
                  / {formatMoney(account.amount)}
                </option>
              ))}
            </select>
          </label>
          <label>
            補正額
            <input name="amount" type="number" step={1} required />
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
          <button type="submit">補正取引を記録</button>
        </form>
        {message === '' ? null : (
          <p className="admin-message" role="status">
            {message}
          </p>
        )}
      </TerminalPanel>

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
      <TerminalPanel heading="三連単キャリーオーバー">
        {economy.carryover === null ? (
          <p>carryover口座がありません。</p>
        ) : (
          <dl className="metric-list">
            <div>
              <dt>projection</dt>
              <dd>{formatMoney(economy.carryover.amountProjection)}</dd>
            </div>
            <div>
              <dt>account balance</dt>
              <dd>{formatMoney(economy.carryover.accountBalance)}</dd>
            </div>
            <div>
              <dt>updated</dt>
              <dd>{formatTimestamp(economy.carryover.updatedAt)}</dd>
            </div>
          </dl>
        )}
      </TerminalPanel>
      <OperationTable
        heading="seed P/L"
        rows={economy.seedPositions}
        columns={[
          ['raceDate', '開催日'],
          ['raceName', 'レース'],
          ['poolType', '券種'],
          ['selectionCode', '買い目'],
          ['stake', 'seed'],
          ['payout', '払戻'],
          ['profitLoss', '損益'],
        ]}
        moneyColumns={new Set(['stake', 'payout', 'profitLoss'])}
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
    </div>
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
          <thead>
            <tr>
              {columns.map(([key, label]) => (
                <th key={key}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={String(row.id ?? row.transactionId ?? `${heading}-${String(index)}`)}>
                {columns.map(([key]) => (
                  <td key={key}>
                    {moneyColumns.has(key)
                      ? formatMoney(row[key])
                      : key.toLowerCase().endsWith('at')
                        ? formatTimestamp(row[key])
                        : String(row[key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TerminalPanel>
  );
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
