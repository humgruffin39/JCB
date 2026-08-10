import { DomainError } from './errors.js';

declare const timestampBrand: unique symbol;

export type Timestamp = number & { readonly [timestampBrand]: 'Timestamp' };

export interface Clock {
  now(): Timestamp;
}

export function timestamp(value: number): Timestamp {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainError(
      'INVALID_TIMESTAMP',
      'Timestamp must be a non-negative epoch millisecond.',
    );
  }
  return value as Timestamp;
}

export const JST_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1000;

export function toJstDateKey(value: Timestamp): string {
  return new Date(value + JST_OFFSET_MILLISECONDS).toISOString().slice(0, 10);
}

export function jstDateTimeToTimestamp(dateKey: string, time: string): Timestamp {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    throw new DomainError('INVALID_TIMESTAMP', 'JST date/time must use YYYY-MM-DD and HH:mm:ss.');
  }
  const parsed = Date.parse(`${dateKey}T${time}+09:00`);
  return timestamp(parsed);
}

export type RaceKind = 'regular' | 'midweek' | 'saturday_night';

export function raceKindForJstDate(dateKey: string): RaceKind {
  const midday = Date.parse(`${dateKey}T12:00:00+09:00`);
  if (!Number.isFinite(midday)) {
    throw new DomainError('INVALID_TIMESTAMP', 'Race date is invalid.');
  }
  const jstDay = new Date(midday + JST_OFFSET_MILLISECONDS).getUTCDay();
  if (jstDay === 3) return 'midweek';
  if (jstDay === 6) return 'saturday_night';
  return 'regular';
}
