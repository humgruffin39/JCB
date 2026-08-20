import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatMoney, OperationTable } from './currency-operation-table.js';
import { SystemHealthReadout } from './system-health-readout.js';

describe('admin presenters', () => {
  it('formats integer balances without losing precision', () => {
    expect(formatMoney('900719925474099312345')).toBe('900,719,925,474,099,312,345 CP');
    expect(formatMoney('not-a-balance')).toBe('—');
  });

  it('renders operation tables with an accessible caption and localized values', () => {
    const markup = renderToStaticMarkup(
      <OperationTable
        heading="口座残高"
        rows={[{ id: 'account-1', accountType: 'user', amount: '1234' }]}
        columns={[
          ['accountType', '種別'],
          ['amount', '残高'],
        ]}
        moneyColumns={new Set(['amount'])}
      />,
    );

    expect(markup).toContain('<caption class="visually-hidden">口座残高</caption>');
    expect(markup).toContain('利用者');
    expect(markup).toContain('1,234 CP');
  });

  it('groups and localizes system health values', () => {
    const markup = renderToStaticMarkup(
      <SystemHealthReadout
        health={{
          databaseReadWrite: true,
          centralBankBalance: '25000',
          topTwentyPercentShareBasisPoints: 1234,
        }}
      />,
    );

    expect(markup).toContain('接続・稼働');
    expect(markup).toContain('データベース読み書き');
    expect(markup).toContain('25,000 CP');
    expect(markup).toContain('12.3%');
  });

  it('localizes every current ledger transaction kind', () => {
    const kinds = [
      ['initial_grant', '初回付与'],
      ['seed_liquidity', '初期流動性の投入'],
      ['bet_purchase', '馬券購入'],
      ['pool_settlement', '投票プールの精算'],
      ['bet_refund', '馬券の返金'],
      ['seed_refund', '初期流動性の返金'],
      ['relief', '救済給付'],
      ['admin_adjustment', '管理者補正'],
      ['issuance', '発行'],
    ] as const;
    const markup = renderToStaticMarkup(
      <OperationTable
        heading="台帳"
        rows={kinds.map(([kind], index) => ({ id: String(index), kind }))}
        columns={[['kind', '種別']]}
      />,
    );
    for (const [, label] of kinds) expect(markup).toContain(label);
  });
});
