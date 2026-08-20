import { POOL_TYPES } from '@jcb/contracts';
import { poolTypeLabel } from './admin-labels.js';

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
});
