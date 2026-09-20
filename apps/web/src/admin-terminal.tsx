import { useState } from 'react';
import { AdminSectionVisibility } from './admin-section-visibility.js';
import { AdminTabList, type AdminTabDefinition } from './admin-tab-list.js';
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
] as const satisfies readonly AdminTabDefinition<AdminSection>[];

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
        {/*
          Every section stays mounted, so changing tab swaps what is shown and
          nothing else: no fetch, no placeholder, no second frame where the
          panel is half there. The hidden ones stop polling until they are back.
        */}
        <div id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${section}`} tabIndex={0}>
          <div className="admin-section" hidden={section !== 'races'}>
            <AdminSectionVisibility isActive={section === 'races'}>
              <RaceAdmin />
            </AdminSectionVisibility>
          </div>
          <div className="admin-section" hidden={section !== 'horses'}>
            <AdminSectionVisibility isActive={section === 'horses'}>
              <HorseAdmin />
            </AdminSectionVisibility>
          </div>
          <div className="admin-section" hidden={section !== 'currency'}>
            <AdminSectionVisibility isActive={section === 'currency'}>
              <CurrencyAdmin />
            </AdminSectionVisibility>
          </div>
          <div className="admin-section" hidden={section !== 'system'}>
            <AdminSectionVisibility isActive={section === 'system'}>
              <SystemAdmin />
            </AdminSectionVisibility>
          </div>
        </div>
      </div>
    </AdminToastProvider>
  );
}
