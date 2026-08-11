import { adminAdjustmentSchema, createRaceSchema } from './admin.js';
import { timestampSchema } from './common.js';

describe('administrative input boundaries', () => {
  it('rejects nonexistent race dates', () => {
    const parsed = createRaceSchema.safeParse({
      raceDate: '2026-02-31',
      name: 'invalid date',
      distanceM: 1_600,
      surface: 'turf',
      scheduledAt: 20_000,
      bettingOpensAt: 10_000,
      bettingClosesAt: 15_000,
      viewerOpensAt: 15_000,
      entries: Array.from({ length: 8 }, (_, index) => ({
        horseId: `horse-${String(index + 1)}`,
        horseNumber: index + 1,
      })),
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unsafe epoch millisecond integers', () => {
    expect(timestampSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  });
});

describe('admin adjustment contracts', () => {
  it('rejects values that could overflow persisted ledger arithmetic', () => {
    expect(() =>
      adminAdjustmentSchema.parse({
        accountId: 'account',
        amount: '999999999999999999999999999999',
        reason: 'overflow regression',
        idempotencyKey: 'overflow-test',
      }),
    ).toThrow(/monetary range/i);
  });
});
