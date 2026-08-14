import { describe, expect, it } from 'vitest';
import { formatCountLegend } from '../discord/legendCommand.js';

describe('/leaderboard', () => {
  it('shows placeholders before successful counts are tracked', () => {
    expect(formatCountLegend({})).toBe(
      ['**カウント数ランキング**', '1位：該当者なし', '2位：該当者なし', '3位：該当者なし'].join(
        '\n',
      ),
    );
  });

  it('shows the top three successful counters without an embed', () => {
    expect(
      formatCountLegend({
        '30': '18',
        '31': '25',
        '32': '12',
        '33': '4',
      }),
    ).toBe(
      [
        '**カウント数ランキング**',
        '1位：<@31>（25回）',
        '2位：<@30>（18回）',
        '3位：<@32>（12回）',
      ].join('\n'),
    );
  });

  it('orders ties deterministically by user ID', () => {
    expect(
      formatCountLegend({
        '32': '5',
        '30': '5',
        '31': '5',
      }),
    ).toBe(
      [
        '**カウント数ランキング**',
        '1位：<@30>（5回）',
        '2位：<@31>（5回）',
        '3位：<@32>（5回）',
      ].join('\n'),
    );
  });
});
