import { POOL_TYPES } from '@jcb/contracts';
import {
  accountTypeLabel,
  auditActionLabel,
  auditTargetLabel,
  poolTypeLabel,
} from './admin-labels.js';

describe('pool type labels', () => {
  it('labels every supported pool type', () => {
    expect(POOL_TYPES.map(poolTypeLabel)).toEqual([
      '単勝',
      '複勝',
      '馬連',
      '馬単',
      'ワイド',
      '3連複',
      '3連単',
    ]);
  });

  it('falls back for unknown pool types', () => {
    expect(poolTypeLabel('unknown')).toBe('その他');
  });

  it('labels every race pool account type', () => {
    expect(
      [
        'race_win_pool',
        'race_place_pool',
        'race_quinella_pool',
        'race_exacta_pool',
        'race_wide_pool',
        'race_trio_pool',
        'race_trifecta_pool',
      ].map(accountTypeLabel),
    ).toEqual([
      '単勝プール',
      '複勝プール',
      '馬連プール',
      '馬単プール',
      'ワイドプール',
      '3連複プール',
      '3連単プール',
    ]);
  });

  it('labels automated audit actions and targets', () => {
    expect(auditActionLabel('economy.central_bank_low')).toBe('中央銀行残高の低下を検知');
    expect(auditActionLabel('object_publication.dead_lettered')).toBe(
      '公開データの自動再試行を停止',
    );
    expect(auditActionLabel('backup.restore_drill_succeeded')).toBe('バックアップ復旧テストに成功');
    expect(auditTargetLabel('scheduled_job')).toBe('自動処理');
    expect(auditTargetLabel('discord_user')).toBe('Discord利用者');
    expect(auditTargetLabel('race_date')).toBe('開催日');
    expect(auditTargetLabel('backup')).toBe('バックアップ');
  });
});
