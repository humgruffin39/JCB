import { useRef } from 'react';

export interface AdminTabDefinition<Id extends string> {
  readonly id: Id;
  readonly label: string;
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

  const selectAt = (index: number): void => {
    const tab = tabs[wrappedTabIndex(index, tabs.length)];
    if (tab === undefined) return;
    onSelect(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  };

  return (
    <nav className={className} aria-label={label} role="tablist">
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
