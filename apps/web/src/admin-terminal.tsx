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
      <header className="admin-heading">
        <nav className="terminal-tabs" aria-label="管理項目">
          <button
            type="button"
            aria-current={section === 'races'}
            onClick={() => setSection('races')}
          >
            レース管理
          </button>
          <button
            type="button"
            aria-current={section === 'horses'}
            onClick={() => setSection('horses')}
          >
            馬管理
          </button>
          <button
            type="button"
            aria-current={section === 'currency'}
            onClick={() => setSection('currency')}
          >
            通貨管理
          </button>
          <button
            type="button"
            aria-current={section === 'system'}
            onClick={() => setSection('system')}
          >
            システム
          </button>
        </nav>
      </header>
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
  );
}
