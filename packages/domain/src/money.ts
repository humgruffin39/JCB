import { DomainError } from './errors.js';

declare const moneyBrand: unique symbol;

export type Money = bigint & { readonly [moneyBrand]: 'Money' };

export const ZERO_MONEY = 0n as Money;

export function money(value: bigint): Money {
  return value as Money;
}

export function nonNegativeMoney(value: bigint): Money {
  if (value < 0n) {
    throw new DomainError('INVALID_MONEY', 'Money must not be negative.');
  }
  return money(value);
}

export function positiveMoney(value: bigint): Money {
  if (value <= 0n) {
    throw new DomainError('INVALID_MONEY', 'Money must be positive.');
  }
  return money(value);
}

export function addMoney(left: Money, right: Money): Money {
  return money(left + right);
}

export function subtractMoney(left: Money, right: Money): Money {
  return money(left - right);
}

export function formatMoneyJson(value: Money): string {
  return value.toString(10);
}

export function parseMoneyJson(value: string): Money {
  if (!/^-?\d+$/.test(value)) {
    throw new DomainError('INVALID_MONEY', 'Money JSON values must be decimal integer strings.');
  }
  return money(BigInt(value));
}
