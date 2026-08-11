import { useState } from 'react';
import { HorseAdmin } from './horse-admin.js';
import { RaceAdmin } from './race-admin.js';
import { SystemAdmin } from './system-admin.js';
import { CurrencyAdmin } from './currency-admin.js';

type AdminSection = 'horses' | 'races' | 'currency' | 'system';

export function AdminTerminal() {
  const [section, setSection] = useState<AdminSection>('races');
  return (
    <div className="admin-terminal">
      <h1 className="visually-hidden">管理</h1>
      <nav className="terminal-tabs" aria-label="管理メニュー" role="tablist">
        <button
          type="button"
          id="admin-tab-races"
          role="tab"
          aria-selected={section === 'races'}
          aria-controls="admin-panel"
          onClick={() => setSection('races')}
        >
          レース管理
        </button>
        <button
          type="button"
          id="admin-tab-horses"
          role="tab"
          aria-selected={section === 'horses'}
          aria-controls="admin-panel"
          onClick={() => setSection('horses')}
        >
          馬管理
        </button>
        <button
          type="button"
          id="admin-tab-currency"
          role="tab"
          aria-selected={section === 'currency'}
          aria-controls="admin-panel"
          onClick={() => setSection('currency')}
        >
          通貨管理
        </button>
        <button
          type="button"
          id="admin-tab-system"
          role="tab"
          aria-selected={section === 'system'}
          aria-controls="admin-panel"
          onClick={() => setSection('system')}
        >
          システム
        </button>
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
