import { describe, expect, it } from 'vitest';
import { POOL_TYPES, betResponseSchema, resultResponseSchema } from './viewer.js';

describe('resultResponseSchema', () => {
  it('accepts one complete eight-horse finish order', () => {
    expect(
      resultResponseSchema.safeParse({
        finishOrder: Array.from({ length: 8 }, (_, index) => ({
          horseNumber: index + 1,
          position: index + 1,
          finishTimeMs: 10_000 + index,
        })),
      }).success,
    ).toBe(true);
  });

  it('rejects duplicate horses or positions', () => {
    const result = resultResponseSchema.safeParse({
      finishOrder: Array.from({ length: 8 }, (_, index) => ({
        horseNumber: index === 7 ? 1 : index + 1,
        position: index === 7 ? 1 : index + 1,
        finishTimeMs: 10_000 + index,
      })),
    });
    expect(result.success).toBe(false);
  });
});

describe('betResponseSchema', () => {
  it('accepts every supported pool type', () => {
    for (const poolType of POOL_TYPES) {
      expect(
        betResponseSchema.safeParse({
          id: 'bet-1',
          poolType,
          selectionCode: '1',
          stake: '100',
          status: 'open',
          payout: '0',
          createdAt: 1_000,
        }).success,
      ).toBe(true);
    }
  });

  it('rejects unknown pool types', () => {
    expect(
      betResponseSchema.safeParse({
        id: 'bet-1',
        poolType: 'unknown',
        selectionCode: '1',
        stake: '100',
        status: 'open',
        payout: '0',
        createdAt: 1_000,
      }).success,
    ).toBe(false);
  });
});
