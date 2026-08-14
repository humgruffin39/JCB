import { describe, expect, it } from 'vitest';
import { formatFailureRanking } from '../discord/rankingCommand.js';

describe('/loserboard', () => {
  it('shows placeholders when nobody has failed', () => {
    expect(formatFailureRanking({})).toBe(
      ['**失敗数ランキング**', '1位：該当者なし', '2位：該当者なし', '3位：該当者なし'].join('\n'),
    );
  });

  it('shows the top three by failure count without an embed', () => {
    expect(
      formatFailureRanking({
        '30': '7',
        '31': '12',
        '32': '3',
        '33': '2',
      }),
    ).toBe(
      ['**失敗数ランキング**', '1位：<@31>（12回）', '2位：<@30>（7回）', '3位：<@32>（3回）'].join(
        '\n',
      ),
    );
  });

  it('orders ties deterministically by user ID', () => {
    expect(
      formatFailureRanking({
        '32': '5',
        '30': '5',
        '31': '5',
      }),
    ).toBe(
      ['**失敗数ランキング**', '1位：<@30>（5回）', '2位：<@31>（5回）', '3位：<@32>（5回）'].join(
        '\n',
      ),
    );
  });
});
