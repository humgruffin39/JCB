import { TerminalPanel } from '@jcb/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminTabList } from './admin-tab-list.js';
import { useAdminToast } from './admin-toaster.js';
import { apiRequest } from './api.js';
import { OperationTable, type OperationRow } from './currency-operation-table.js';
import { CurrencyOverview, type AdjustmentDraft } from './currency-overview.js';
import { useAdminPolling } from './use-admin-polling.js';

interface EconomyOperations {
  readonly accounts: readonly OperationRow[];
  readonly bets: readonly OperationRow[];
  readonly settlements: readonly OperationRow[];
  readonly carryover: OperationRow | null;
  readonly seedPositions: readonly OperationRow[];
  readonly relief: readonly OperationRow[];
}

type CurrencySection = 'overview' | 'bets' | 'settlements' | 'profit-loss' | 'ledger';

const CURRENCY_SECTIONS = [
  { id: 'overview', label: '概要' },
  { id: 'bets', label: '馬券' },
  { id: 'settlements', label: '精算・給付' },
  { id: 'profit-loss', label: '損益' },
  { id: 'ledger', label: '台帳' },
] as const satisfies readonly { readonly id: CurrencySection; readonly label: string }[];

export function CurrencyAdmin() {
  const [economy, setEconomy] = useState<EconomyOperations>();
  const [ledger, setLedger] = useState<readonly OperationRow[]>([]);
  const [operationError, setOperationError] = useState('');
  const [section, setSection] = useState<CurrencySection>('overview');
  const previousSection = useRef(section);
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

  async function confirmAdjustment(draft: AdjustmentDraft): Promise<void> {
    setOperationError('');
    await apiRequest('/api/v1/admin/ledger/adjustments', {
      method: 'POST',
      body: JSON.stringify({
        accountId: draft.accountId,
        amount: draft.amount,
        reason: draft.reason,
        idempotencyKey: draft.idempotencyKey,
      }),
    });
    success('残高を補正しました。');
    try {
      await refreshNow();
    } catch (caught) {
      setOperationError(
        caught instanceof Error ? caught.message : '補正後の残高を更新できません。',
      );
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
      <AdminTabList
        label="通貨管理メニュー"
        tabs={CURRENCY_SECTIONS}
        selected={section}
        onSelect={setSection}
        idPrefix="currency-tab"
        panelId="currency-panel"
      />
      {refreshError === undefined ? null : (
        <p className="field-error" role="alert">
          {refreshError} 通貨データを更新できません。
        </p>
      )}
      {operationError === '' ? null : (
        <p className="field-error" role="alert">
          {operationError}
        </p>
      )}
      <div
        id="currency-panel"
        role="tabpanel"
        aria-labelledby={`currency-tab-${section}`}
        tabIndex={0}
      >
        {section === 'overview' ? (
          <CurrencyOverview
            accounts={economy.accounts}
            carryover={economy.carryover}
            onConfirmAdjustment={confirmAdjustment}
          />
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
