import { nextOddsRefreshAt } from './discord-purchase-gateway.js';

describe('Discord race message debounce', () => {
  it('coalesces a burst into one aligned refresh boundary', () => {
    const refreshes = [30_001, 35_000, 59_999].map((current) => nextOddsRefreshAt(current, 30_000));
    expect(new Set(refreshes)).toEqual(new Set([60_000]));
    expect(nextOddsRefreshAt(60_000, 30_000)).toBe(90_000);
  });
});
