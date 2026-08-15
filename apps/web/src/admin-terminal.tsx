import { useState } from 'react';
import { AdminTabList } from './admin-tab-list.js';
import { HorseAdmin } from './horse-admin.js';
import { RaceAdmin } from './race-admin.js';
import { SystemAdmin } from './system-admin.js';
import { CurrencyAdmin } from './currency-admin.js';
import { AdminToastProvider } from './admin-toaster.js';

type AdminSection = 'horses' | 'races' | 'currency' | 'system';

const sections = [
  { id: 'races', label: 'レース管理' },
  { id: 'horses', label: '馬管理' },
  { id: 'currency', label: '通貨管理' },
  { id: 'system', label: 'システム' },
] as const satisfies readonly { readonly id: AdminSection; readonly label: string }[];

export function AdminTerminal() {
  const [section, setSection] = useState<AdminSection>('races');
  return (
    <AdminToastProvider>
      <div className="admin-terminal">
        <h1 className="visually-hidden">管理</h1>
        <AdminTabList
          label="管理メニュー"
          tabs={sections}
          selected={section}
          onSelect={setSection}
          idPrefix="admin-tab"
          panelId="admin-panel"
          className="terminal-tabs"
        />
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
    </AdminToastProvider>
  );
}
