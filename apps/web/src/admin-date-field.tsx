import { useState } from 'react';
import { AdminPopover } from './admin-popover.js';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from './admin-icons.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/**
 * A date field that carries its own calendar.
 *
 * The browser's own picker is a different app's interface dropped into this
 * one: its own type, its own spacing, its own colours, and on Safari a control
 * wide enough to push the dialog sideways. The value is still an `input`, so
 * the form reads it exactly as before.
 */
export function AdminDateField({
  name,
  defaultValue = '',
  required = false,
}: {
  readonly name: string;
  readonly defaultValue?: string;
  readonly required?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);

  return (
    <span className="admin-date-field">
      <input
        name={name}
        type="text"
        inputMode="numeric"
        required={required}
        placeholder="YYYY-MM-DD"
        pattern="\d{4}-\d{2}-\d{2}"
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <AdminPopover label="カレンダーから選ぶ" trigger={<CalendarIcon size={14} ariaHidden />}>
        {(close) => (
          <Calendar
            value={value}
            onSelect={(next) => {
              setValue(next);
              close();
            }}
          />
        )}
      </AdminPopover>
    </span>
  );
}

function Calendar({
  value,
  onSelect,
}: {
  readonly value: string;
  readonly onSelect: (value: string) => void;
}) {
  const selected = parseDateKey(value);
  const [cursor, setCursor] = useState(() => startOfMonth(selected ?? new Date()));
  const today = toDateKey(new Date());

  const firstWeekday = cursor.getDay();
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();

  return (
    <div className="admin-calendar">
      <div className="admin-calendar__header">
        <button
          type="button"
          className="text-button"
          aria-label="前の月"
          onClick={() => setCursor(shiftMonth(cursor, -1))}
        >
          <ChevronLeftIcon size={14} ariaHidden />
        </button>
        <span aria-live="polite">
          {cursor.getFullYear()}年{cursor.getMonth() + 1}月
        </span>
        <button
          type="button"
          className="text-button"
          aria-label="次の月"
          onClick={() => setCursor(shiftMonth(cursor, 1))}
        >
          <ChevronRightIcon size={14} ariaHidden />
        </button>
      </div>
      <div className="admin-calendar__grid" role="grid">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} className="admin-calendar__weekday" aria-hidden="true">
            {weekday}
          </span>
        ))}
        {Array.from({ length: firstWeekday }, (_, index) => (
          <span key={`lead-${String(index)}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1;
          const key = toDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), day));
          return (
            <button
              key={key}
              type="button"
              className="admin-calendar__day"
              aria-pressed={key === value}
              data-today={key === today ? '' : undefined}
              onClick={() => onSelect(key)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function shiftMonth(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

function parseDateKey(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
