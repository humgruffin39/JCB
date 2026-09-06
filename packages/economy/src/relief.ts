import { money, type Money } from '@jcb/domain';

export const DEFAULT_RELIEF_BALANCE_THRESHOLD = money(5_000n);
export const DEFAULT_RELIEF_DAILY_MAXIMUM = money(1_000n);

/** Tops a balance back up to the threshold, never granting more than the daily maximum. */
export function calculateRelief(
  balance: Money,
  threshold: Money = DEFAULT_RELIEF_BALANCE_THRESHOLD,
  dailyMaximum: Money = DEFAULT_RELIEF_DAILY_MAXIMUM,
): Money {
  if (balance >= threshold) return money(0n);
  const gap = threshold - balance;
  return money(gap < dailyMaximum ? gap : dailyMaximum);
}

export function reliefIdempotencyKey(jstDate: string, userId: string): string {
  return `relief:${jstDate}:${userId}`;
}
