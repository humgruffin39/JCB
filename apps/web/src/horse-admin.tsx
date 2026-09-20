import { TerminalPanel } from '@jcb/ui';
import { useCallback, useRef, useState } from 'react';
import { AddIcon, EditIcon } from './admin-icons.js';
import {
  distancePreferenceLabel,
  horseStatusLabel,
  surfacePreferenceLabel,
} from './admin-labels.js';
import { useAdminToast } from './admin-toaster.js';
import { apiRequest } from './api.js';
import { HorseAdminForm } from './horse-admin-form.js';
import { horseCoatLabel, type Horse } from './horse-admin-model.js';
import { useAdminPolling } from './use-admin-polling.js';

export function HorseAdmin() {
  const [horses, setHorses] = useState<readonly Horse[]>([]);
  const [editing, setEditing] = useState<Horse>();
  const [horseFormOpen, setHorseFormOpen] = useState(false);
  const horseFormReturnFocus = useRef<HTMLElement | null>(null);
  const [operationError, setOperationError] = useState('');
  const { success } = useAdminToast();
  const refresh = useCallback(async () => {
    setHorses(await apiRequest<readonly Horse[]>('/api/v1/admin/horses'));
  }, []);
  const { error: refreshError, isInitialLoading, refreshNow } = useAdminPolling(refresh, 10_000);

  function openHorseForm(horse: Horse | undefined, trigger: HTMLElement): void {
    setEditing(horse);
    horseFormReturnFocus.current = trigger;
    setHorseFormOpen(true);
  }

  return (
    <div className="admin-page">
      <TerminalPanel
        heading="登録済みの馬"
        status={`${String(horses.length)}頭`}
        headerAction={
          <button
            type="button"
            className="text-button"
            onClick={(event) => openHorseForm(undefined, event.currentTarget)}
          >
            <AddIcon size={14} ariaHidden />
            馬を登録
          </button>
        }
      >
        {refreshError === undefined ? null : (
          <p className="field-error" role="alert">
            {refreshError} 馬の一覧を更新できません。
          </p>
        )}
        {operationError === '' ? null : (
          <p className="field-error" role="alert">
            {operationError}
          </p>
        )}
        {isInitialLoading ? null : horses.length === 0 ? (
          <div className="empty-copy" role="status">
            <strong>馬が登録されていません</strong>
            <span>上の「馬を登録」から追加できます。</span>
          </div>
        ) : (
          <HorseTable horses={horses} onEdit={openHorseForm} />
        )}
      </TerminalPanel>
      {horseFormOpen ? (
        <HorseAdminForm
          key={editing?.id ?? 'new-horse'}
          returnFocusRef={horseFormReturnFocus}
          {...(editing === undefined ? {} : { horse: editing })}
          onSaved={async (savedMessage) => {
            setEditing(undefined);
            setHorseFormOpen(false);
            success(savedMessage);
            try {
              await refreshNow();
            } catch (caught) {
              setOperationError(
                caught instanceof Error
                  ? `保存後の一覧を更新できませんでした。${caught.message}`
                  : '保存後の一覧を更新できませんでした。',
              );
            }
          }}
          onCancel={() => {
            setEditing(undefined);
            setHorseFormOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function HorseTable({
  horses,
  onEdit,
}: {
  readonly horses: readonly Horse[];
  readonly onEdit: (horse: Horse, trigger: HTMLElement) => void;
}) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">登録済みの馬</caption>
        <thead>
          <tr>
            <th scope="col">馬名</th>
            <th scope="col">状態</th>
            <th scope="col">脚質</th>
            <th scope="col">毛色</th>
            <th scope="col">距離</th>
            <th scope="col">馬場</th>
            <th scope="col">
              <span className="visually-hidden">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {horses.map((horse) => (
            <tr key={horse.id}>
              <td>{horse.name}</td>
              <td>
                <span
                  className={`status-badge status-badge--${horse.status === 'active' ? 'success' : 'neutral'}`}
                >
                  {horseStatusLabel(horse.status)}
                </span>
              </td>
              <td>{horse.runningStyle === 'front_runner' ? '逃げ' : '差し'}</td>
              <td>{horseCoatLabel(horse.coatColor)}</td>
              <td>{distancePreferenceLabel(horse.distancePreference)}</td>
              <td>{surfacePreferenceLabel(horse.surfacePreference)}</td>
              <td>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={(event) => onEdit(horse, event.currentTarget)}
                  >
                    <EditIcon size={13} ariaHidden />
                    編集する
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
