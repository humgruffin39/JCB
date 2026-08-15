import { TerminalPanel } from '@jcb/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { horseStatusLabel } from './admin-labels.js';
import { useAdminToast } from './admin-toaster.js';
import { apiRequest } from './api.js';
import { HorseAdminForm } from './horse-admin-form.js';
import { horseCoatLabel, type Horse, type HorsePerformance } from './horse-admin-model.js';
import { HorsePerformanceDialog } from './horse-performance-dialog.js';
import { useAdminPolling } from './use-admin-polling.js';

export function HorseAdmin() {
  const [horses, setHorses] = useState<readonly Horse[]>([]);
  const [editing, setEditing] = useState<Horse>();
  const [horseFormOpen, setHorseFormOpen] = useState(false);
  const horseFormReturnFocus = useRef<HTMLElement | null>(null);
  const [performance, setPerformance] = useState<{
    readonly horse: Horse;
    readonly record: HorsePerformance;
  }>();
  const [loadingPerformanceId, setLoadingPerformanceId] = useState<string>();
  const performanceRequestId = useRef(0);
  const [operationError, setOperationError] = useState('');
  const { success } = useAdminToast();
  const refresh = useCallback(async () => {
    setHorses(await apiRequest<readonly Horse[]>('/api/v1/admin/horses'));
  }, []);
  const { error: refreshError, isInitialLoading, refreshNow } = useAdminPolling(refresh, 10_000);

  useEffect(
    () => () => {
      performanceRequestId.current += 1;
    },
    [],
  );

  function openHorseForm(horse: Horse | undefined, trigger: HTMLElement): void {
    setEditing(horse);
    horseFormReturnFocus.current = trigger;
    setHorseFormOpen(true);
  }

  async function showPerformance(horse: Horse): Promise<void> {
    const requestId = performanceRequestId.current + 1;
    performanceRequestId.current = requestId;
    setLoadingPerformanceId(horse.id);
    setOperationError('');
    try {
      const record = await apiRequest<HorsePerformance>(
        `/api/v1/admin/horses/${horse.id}/performance`,
      );
      if (requestId === performanceRequestId.current) setPerformance({ horse, record });
    } catch (caught) {
      if (requestId === performanceRequestId.current) {
        setOperationError(caught instanceof Error ? caught.message : '戦績を取得できません。');
      }
    } finally {
      if (requestId === performanceRequestId.current) setLoadingPerformanceId(undefined);
    }
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
        {isInitialLoading ? (
          <p className="empty-copy" role="status" aria-live="polite">
            馬の一覧を読み込んでいます。
          </p>
        ) : horses.length === 0 ? (
          <div className="empty-copy" role="status">
            <strong>馬が登録されていません</strong>
            <span>上の「馬を登録」から追加できます。</span>
          </div>
        ) : (
          <HorseTable
            horses={horses}
            loadingPerformanceId={loadingPerformanceId}
            onEdit={openHorseForm}
            onShowPerformance={(horse) => void showPerformance(horse)}
          />
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
      {performance === undefined ? null : (
        <HorsePerformanceDialog
          horse={performance.horse}
          record={performance.record}
          onClose={() => setPerformance(undefined)}
        />
      )}
    </div>
  );
}

function HorseTable({
  horses,
  loadingPerformanceId,
  onEdit,
  onShowPerformance,
}: {
  readonly horses: readonly Horse[];
  readonly loadingPerformanceId: string | undefined;
  readonly onEdit: (horse: Horse, trigger: HTMLElement) => void;
  readonly onShowPerformance: (horse: Horse) => void;
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
            <th scope="col">速度</th>
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
              <td>{String(horse.speed)}</td>
              <td>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={(event) => onEdit(horse, event.currentTarget)}
                  >
                    編集する
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onShowPerformance(horse)}
                    disabled={loadingPerformanceId !== undefined}
                  >
                    {loadingPerformanceId === horse.id ? '読み込み中…' : '戦績を見る'}
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
