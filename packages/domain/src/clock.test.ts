import { jstDateTimeToTimestamp, raceKindForJstDate } from './clock.js';

describe('JST calendar validation', () => {
  it('rejects normalized but nonexistent calendar dates', () => {
    expect(() => jstDateTimeToTimestamp('2026-02-29', '22:00:00')).toThrow(/YYYY-MM-DD/);
    expect(() => jstDateTimeToTimestamp('2026-04-31', '22:00:00')).toThrow(/YYYY-MM-DD/);
    expect(() => raceKindForJstDate('2026-02-31')).toThrow(/invalid/i);
  });

  it('accepts a real leap day and strict time-of-day values', () => {
    expect(jstDateTimeToTimestamp('2028-02-29', '22:00:00')).toBe(
      Date.parse('2028-02-29T22:00:00+09:00'),
    );
    expect(() => jstDateTimeToTimestamp('2028-02-29', '24:00:00')).toThrow(/YYYY-MM-DD/);
  });
});
