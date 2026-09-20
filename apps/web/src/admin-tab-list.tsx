import { useLayoutEffect, useRef, useState } from 'react';

export interface AdminTabDefinition<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

interface Indicator {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function AdminTabList<Id extends string>({
  label,
  tabs,
  selected,
  onSelect,
  idPrefix,
  panelId,
  className = 'admin-subnav',
}: {
  readonly label: string;
  readonly tabs: readonly AdminTabDefinition<Id>[];
  readonly selected: Id;
  readonly onSelect: (id: Id) => void;
  readonly idPrefix: string;
  readonly panelId: string;
  readonly className?: string;
}) {
  const tabRefs = useRef(new Map<Id, HTMLButtonElement>());
  const listRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<Indicator>();
  // The first measurement places the lit surface; it does not slide into place
  // from nowhere. Only a change of tab is movement worth showing.
  const [hasPlaced, setHasPlaced] = useState(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;

    const measure = (): void => {
      const tab = tabRefs.current.get(selected);
      if (tab === undefined) return;
      // Rects, not offsets: the offset properties round to whole pixels, which
      // leaves the surface half a pixel off centre on a 27px chip in a 48px row.
      const listBox = list.getBoundingClientRect();
      const box = tab.getBoundingClientRect();
      // A section that is mounted but hidden measures zero. Placing the surface
      // on that and correcting it when the section is shown is what made it fly
      // in from the corner, so a zero measurement is no measurement.
      if (box.width === 0) return;
      setIndicator({
        left: box.left - listBox.left + list.scrollLeft,
        top: box.top - listBox.top,
        width: box.width,
        height: box.height,
      });
    };

    measure();
    // The labels are laid out once the font lands, the row is scrollable, and
    // the whole section can be hidden, so the measurement has to survive all
    // three.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const tab of tabRefs.current.values()) observer.observe(tab);
    return () => {
      observer.disconnect();
    };
  }, [selected, tabs]);

  // The surface appears where it belongs. It animates only once it is there,
  // which is what keeps a first paint from sliding out of the corner.
  useLayoutEffect(() => {
    if (indicator === undefined || hasPlaced) return;
    const frame = requestAnimationFrame(() => setHasPlaced(true));
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [hasPlaced, indicator]);

  const selectAt = (index: number): void => {
    const tab = tabs[wrappedTabIndex(index, tabs.length)];
    if (tab === undefined) return;
    onSelect(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  };

  return (
    <nav ref={listRef} className={className} aria-label={label} role="tablist">
      {indicator === undefined ? null : (
        <span
          className="admin-tab-indicator"
          aria-hidden="true"
          data-placed={hasPlaced ? '' : undefined}
          style={{
            transform: `translate(${String(indicator.left)}px, ${String(indicator.top)}px)`,
            width: indicator.width,
            height: indicator.height,
          }}
        />
      )}
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => {
            if (element === null) tabRefs.current.delete(tab.id);
            else tabRefs.current.set(tab.id, element);
          }}
          id={`${idPrefix}-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={selected === tab.id}
          aria-controls={panelId}
          tabIndex={selected === tab.id ? 0 : -1}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              selectAt(index + 1);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              selectAt(index - 1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              selectAt(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              selectAt(tabs.length - 1);
            }
          }}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

export function wrappedTabIndex(index: number, tabCount: number): number {
  if (tabCount <= 0) return 0;
  return ((index % tabCount) + tabCount) % tabCount;
}
