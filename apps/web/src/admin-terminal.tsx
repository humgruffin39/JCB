import { useRef, useState } from 'react';
import { HorseAdmin } from './horse-admin.js';
import { RaceAdmin } from './race-admin.js';
import { SystemAdmin } from './system-admin.js';
import { CurrencyAdmin } from './currency-admin.js';

type AdminSection = 'horses' | 'races' | 'currency' | 'system';

const sections: readonly { id: AdminSection; label: string }[] = [
  { id: 'races', label: 'レース管理' },
  { id: 'horses', label: '馬管理' },
  { id: 'currency', label: '通貨管理' },
  { id: 'system', label: 'システム' },
];

export function AdminTerminal() {
  const [section, setSection] = useState<AdminSection>('races');
  const tabRefs = useRef<Partial<Record<AdminSection, HTMLButtonElement>>>({});
  const moveTab = (index: number): void => {
    const nextSection = sections[(index + sections.length) % sections.length]!.id;
    setSection(nextSection);
    tabRefs.current[nextSection]?.focus();
  };
  return (
    <div className="admin-terminal">
      <h1 className="visually-hidden">管理</h1>
      <nav className="terminal-tabs" aria-label="管理メニュー" role="tablist">
        {sections.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              tabRefs.current[tab.id] = element ?? undefined;
            }}
            type="button"
            id={`admin-tab-${tab.id}`}
            role="tab"
            aria-selected={section === tab.id}
            aria-controls="admin-panel"
            tabIndex={section === tab.id ? 0 : -1}
            onClick={() => setSection(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                moveTab(index + 1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                moveTab(index - 1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                moveTab(0);
              } else if (event.key === 'End') {
                event.preventDefault();
                moveTab(sections.length - 1);
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${section}`} tabIndex={0}>
        {section === 'horses' ? (
          <HorseAdmin />
        ) : section === 'races' ? (
          <RaceAdmin />
        ) : section === 'currency' ? (
          <CurrencyAdmin />
        ) : (
          <SystemAdmin />
        )}
      </div>
    </div>
  );
}
