import { TerminalPanel } from '@jcb/ui';
import {
  accountTypeLabel,
  betStatusLabel,
  poolTypeLabel,
  referenceTypeLabel,
} from './admin-labels.js';
import { formatDateKeyForDisplay } from './race-admin-utils.js';

export type OperationRow = Readonly<Record<string, string | number | null>>;

export function OperationTable({
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
  if (key === 'raceDate') return formatDateKeyForDisplay(String(value ?? ''));
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

export function formatMoney(value: string | number | null | undefined): string {
  const text = String(value ?? '');
  return /^-?\d+$/.test(text) ? `${BigInt(text).toLocaleString('ja-JP')} R` : '—';
}

export function formatTimestamp(value: string | number | null | undefined): string {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? new Date(milliseconds).toLocaleString('ja-JP')
    : '—';
}
