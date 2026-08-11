import { describe, expect, it } from 'vitest';
import { resultResponseSchema } from './viewer.js';

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
