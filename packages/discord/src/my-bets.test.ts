import { describe, expect, it } from 'vitest';
import { renderMyBets } from './my-bets.js';

function bet(selectionCode: string, status: string, stake = '100') {
  return { poolType: 'trifecta' as const, selectionCode, stake, status };
}

describe('my bets', () => {
  it('lists a handful of tickets one by one', () => {
    expect(renderMyBets([bet('1-2-3', 'open'), bet('1-2-4', 'open')]).split('\n')).toHaveLength(2);
  });

  it('collapses a formation but keeps the winning ticket readable', () => {
    const bets = [
      ...Array.from({ length: 19 }, (_, index) => bet(`1-2-${String(index + 3)}`, 'lost')),
      bet('6-2-1', 'won'),
    ];

    expect(renderMyBets(bets)).toBe(
      [
        '3連単 19点 / 各100 CP / 計1,900 CP / 状態: 外れ',
        '3連単 <:horse_6:1539913574695051274> <:horse_2:1539913568982536253> <:horse_1:1539913567787159653> / 100 CP / 状態: 的中',
      ].join('\n'),
    );
  });

  it('stays inside the Discord message limit', () => {
    const bets = Array.from({ length: 200 }, (_, index) =>
      bet(`1-2-${String((index % 6) + 3)}`, 'open', String(100 + index)),
    );

    expect(renderMyBets(bets).length).toBeLessThanOrEqual(1_900);
    expect(renderMyBets(bets)).toContain('ほか');
  });

  it('says so when nothing was bought', () => {
    expect(renderMyBets([])).toBe('このレースで購入済みの馬券はありません。');
  });
});
