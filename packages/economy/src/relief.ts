import { money, type Money } from '@jcb/domain';

export function calculateRelief(balance: Money): Money {
  if (balance >= 5_000n) return money(0n);
  const gap = 5_000n - balance;
  return money(gap < 1_000n ? gap : 1_000n);
}

export function reliefIdempotencyKey(jstDate: string, userId: string): string {
  return `relief:${jstDate}:${userId}`;
}
