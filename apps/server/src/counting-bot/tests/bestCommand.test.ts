import { describe, expect, it } from 'vitest';
import { formatBestCount } from '../discord/bestCommand.js';

describe('/best', () => {
  it('shows the highest count without an embed', () => {
    expect(formatBestCount('123')).toBe('最高記録：123');
  });

  it('supports counts above the safe integer range', () => {
    expect(formatBestCount('9007199254740993')).toBe('最高記録：9007199254740993');
  });
});
