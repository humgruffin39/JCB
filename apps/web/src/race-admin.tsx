import { TerminalPanel } from '@jcb/ui';
import { useRef, useState } from 'react';
import {
  CancellationDialog,
  EmergencyRevealDialog,
  RehearsalDialog,
} from './race-admin-dialogs.js';
import { RaceForm } from './race-admin-form.js';
import { RaceAdminList } from './race-admin-list.js';
import type { AdminRace } from './race-admin-model.js';
import { useAdminToast } from './admin-toaster.js';
import { useRaceAdminData } from './use-race-admin-data.js';

export function RaceAdmin() {
  const {
    races,
    horses,
    schedule,
    isInitialLoading,
    refreshError,
    formOptionsError,
    operationError,
    pendingOperation,
    refresh,
    transition,
    retry,
    rehearseNow,
    cancelRace,
  } = useRaceAdminData();
  const [cancelling, setCancelling] = useState<AdminRace>();
  const [rehearsing, setRehearsing] = useState<AdminRace>();
  const [editing, setEditing] = useState<AdminRace>();
  const [raceFormOpen, setRaceFormOpen] = useState(false);
  const raceFormReturnFocus = useRef<HTMLElement | null>(null);
  const [revealing, setRevealing] = useState<AdminRace>();
  const { success } = useAdminToast();

  function openRaceForm(race: AdminRace | undefined, trigger: HTMLElement): void {
    setEditing(race);
    raceFormReturnFocus.current = trigger;
    setRaceFormOpen(true);
  }

  return (
    <div className="admin-page">
      <TerminalPanel
        heading="開催一覧"
        status={`${String(races.length)}件`}
        headerAction={
          <button
            type="button"
            className="text-button"
            onClick={(event) => openRaceForm(undefined, event.currentTarget)}
          >
            レースを作成
          </button>
        }
      >
        {refreshError === undefined ? null : (
          <p className="field-error" role="alert">
            {refreshError}
          </p>
        )}
        {formOptionsError === '' ? null : (
          <p className="field-error" role="alert">
            {formOptionsError}
          </p>
        )}
        {operationError === '' ? null : (
          <p className="field-error" role="alert">
            {operationError}
          </p>
        )}
        {isInitialLoading ? (
          <div className="empty-copy" role="status" aria-live="polite">
            <strong>レース一覧を読み込んでいます</strong>
          </div>
        ) : races.length === 0 ? (
          <div className="empty-copy" role="status">
            <strong>レースがありません</strong>
          </div>
        ) : (
          <RaceAdminList
            races={races}
            pendingOperation={pendingOperation}
            onEdit={openRaceForm}
            onTransition={transition}
            onRetry={retry}
            onRehearse={setRehearsing}
            onReveal={setRevealing}
            onCancel={setCancelling}
          />
        )}
      </TerminalPanel>

      {raceFormOpen ? (
        <RaceForm
          key={editing?.id ?? 'new-race'}
          horses={horses}
          schedule={schedule}
          returnFocusRef={raceFormReturnFocus}
          {...(editing === undefined ? {} : { race: editing })}
          onSaved={async () => {
            success(
              editing === undefined ? 'レースを下書き保存しました。' : '下書きを更新しました。',
            );
            setEditing(undefined);
            setRaceFormOpen(false);
            await refresh();
          }}
          onCancel={() => {
            setEditing(undefined);
            setRaceFormOpen(false);
          }}
        />
      ) : null}

      {cancelling === undefined ? null : (
        <CancellationDialog
          race={cancelling}
          onClose={() => setCancelling(undefined)}
          onConfirm={async (race, reason) => {
            await cancelRace(race, reason);
            setCancelling(undefined);
          }}
        />
      )}
      {rehearsing === undefined ? null : (
        <RehearsalDialog
          race={rehearsing}
          onClose={() => setRehearsing(undefined)}
          onConfirm={async (race) => {
            await rehearseNow(race);
            setRehearsing(undefined);
          }}
        />
      )}
      {revealing === undefined ? null : (
        <EmergencyRevealDialog race={revealing} onClose={() => setRevealing(undefined)} />
      )}
    </div>
  );
}
