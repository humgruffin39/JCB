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

export function formatDateKeyForDisplay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match === null ? value : `${match[1]}/${match[2]}/${match[3]}`;
}

export function jstDateTimeToTimestamp(dateKey: string, time: string): Timestamp {
  if (!isCalendarDate(dateKey) || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) {
    throw new DomainError('INVALID_TIMESTAMP', 'JST date/time must use YYYY-MM-DD and HH:mm:ss.');
  }
  const parsed = Date.parse(`${dateKey}T${time}+09:00`);
  return timestamp(parsed);
}

export type RaceKind = 'regular' | 'midweek' | 'saturday_night';

export function raceKindForJstDate(dateKey: string): RaceKind {
  if (!isCalendarDate(dateKey)) {
    throw new DomainError('INVALID_TIMESTAMP', 'Race date is invalid.');
  }
  const midday = Date.parse(`${dateKey}T12:00:00+09:00`);
  if (!Number.isFinite(midday)) {
    throw new DomainError('INVALID_TIMESTAMP', 'Race date is invalid.');
  }
  const jstDay = new Date(midday + JST_OFFSET_MILLISECONDS).getUTCDay();
  if (jstDay === 3) return 'midweek';
  if (jstDay === 6) return 'saturday_night';
  return 'regular';
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}
