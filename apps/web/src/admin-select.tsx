import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon } from './admin-icons.js';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface AdminSelectProps {
  readonly label: string;
  readonly name: string;
  readonly options: readonly SelectOption[];
  /** Uncontrolled. Leave `value` out and read the result from the form. */
  readonly defaultValue?: string;
  /** Controlled. Pass both, and `onChange` is the only way the value moves. */
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  /** Shown in place of a label while nothing is chosen. */
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

/**
 * A list you can see, rather than the one the operating system draws.
 *
 * A native `select` hands its popup to the platform: a wheel at the bottom of
 * a phone, a menu in the system's own colours on a desktop, and a control
 * whose height half of them refuse to set. This is the same control built out
 * of elements this app styles itself, so it reads the same everywhere.
 *
 * The value still reaches a form the way a `select`'s does, through a hidden
 * input carrying the same `name`.
 */
export function AdminSelect({
  label,
  name,
  options,
  defaultValue,
  value,
  onChange,
  placeholder = '選択してください',
  disabled = false,
}: AdminSelectProps) {
  const labelId = useId();
  const listId = useId();
  const optionId = useId();
  const controlRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? '');
  const current = value ?? uncontrolled;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );

  const selected = options.find((option) => option.value === current);

  const choose = (next: string): void => {
    if (value === undefined) setUncontrolled(next);
    onChange?.(next);
    setOpen(false);
    controlRef.current?.focus();
  };

  const openList = (index: number): void => {
    setActiveIndex(index < 0 ? 0 : index);
    setOpen(true);
  };

  /*
   * The list is positioned against the viewport rather than against the field.
   * The field can sit inside a dialog that scrolls its own body, and an
   * absolutely positioned list in there is cut off at the edge of the scroll.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const control = controlRef.current;
      if (control === null) return;
      const box = control.getBoundingClientRect();
      const height = listRef.current?.offsetHeight ?? 0;
      const below = window.innerHeight - box.bottom;
      const flip = below < height + 8 && box.top > below;
      setPlacement({
        top: flip ? Math.max(8, box.top - height - 4) : box.bottom + 4,
        left: box.left,
        width: box.width,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, options.length]);

  // The active option is kept in view as the arrows walk past the edge.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${String(activeIndex)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  /*
   * Escape is taken here, at the document and before anything else sees it.
   * The field sits inside a dialog, and a dialog closes itself on Escape; the
   * press means close the list and nothing more. Stopping it on the button's
   * own handler is not enough, because WebKit has already decided by then.
   */
  useEffect(() => {
    if (!open) return;
    const swallow = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      controlRef.current?.focus();
    };
    document.addEventListener('keydown', swallow, true);
    return () => {
      document.removeEventListener('keydown', swallow, true);
    };
  }, [open]);

  // A press anywhere else closes it, the same as a menu would.
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (controlRef.current?.contains(target) === true) return;
      if (listRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    return () => {
      document.removeEventListener('mousedown', dismiss);
    };
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const index = options.findIndex((option) => option.value === current);
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openList(index);
      }
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = options[activeIndex];
      if (option !== undefined) choose(option.value);
      return;
    }
    const moves: Record<string, number> = {
      ArrowDown: activeIndex + 1,
      ArrowUp: activeIndex - 1,
      Home: 0,
      End: options.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActiveIndex(Math.max(0, Math.min(options.length - 1, next)));
  };

  return (
    <div className="admin-select">
      <span id={labelId} className="admin-select__label">
        {label}
      </span>
      <button
        ref={controlRef}
        type="button"
        role="combobox"
        className="admin-select__control"
        aria-labelledby={labelId}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${optionId}-${String(activeIndex)}` : undefined}
        data-empty={selected === undefined ? '' : undefined}
        disabled={disabled}
        onClick={() => {
          if (open) setOpen(false);
          else openList(options.findIndex((option) => option.value === current));
        }}
        onKeyDown={onKeyDown}
      >
        <span className="admin-select__value">{selected?.label ?? placeholder}</span>
        <ChevronDownIcon size={14} ariaHidden className="admin-select__caret" />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          className="admin-select__list scroll-area"
          style={
            placement === null
              ? { visibility: 'hidden' }
              : { top: placement.top, left: placement.left, minWidth: placement.width }
          }
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${optionId}-${String(index)}`}
              data-index={index}
              role="option"
              aria-selected={option.value === current}
              className="admin-select__option"
              data-active={index === activeIndex ? '' : undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option.value)}
            >
              <span>{option.label}</span>
              {option.value === current && <CheckIcon size={13} ariaHidden />}
            </li>
          ))}
        </ul>
      )}
      <input type="hidden" name={name} value={current} />
    </div>
  );
}
