import { TerminalPanel } from '@jcb/ui';
import { useCallback, useRef, useState } from 'react';
import { z } from 'zod';
import { AdministratorAdmin } from './administrator-admin.js';
import { AdminTabList } from './admin-tab-list.js';
import { useAdminToast } from './admin-toaster.js';
import { apiRequest } from './api.js';
import { SettingsAdmin } from './settings-admin.js';
import {
  SystemAuditPanel,
  SystemJobsPanel,
  SystemObjectsPanel,
  type SystemAuditRow,
  type SystemJobRow,
  type SystemObjects,
} from './system-admin-sections.js';
import { SystemHealthReadout } from './system-health-readout.js';
import { useAdminPolling } from './use-admin-polling.js';

type SystemSection = 'status' | 'jobs' | 'objects' | 'settings' | 'administrators' | 'audit';

const SYSTEM_SECTIONS = [
  { id: 'status', label: '状態' },
  { id: 'jobs', label: '自動処理' },
  { id: 'objects', label: '公開データ' },
  { id: 'settings', label: '運用設定' },
  { id: 'administrators', label: '管理者' },
  { id: 'audit', label: '監査ログ' },
] as const satisfies readonly { readonly id: SystemSection; readonly label: string }[];

const EMPTY_OBJECTS: SystemObjects = {
  discordMessages: [],
  timelineObjects: [],
  objectPublications: [],
};

export function SystemAdmin() {
  const [health, setHealth] = useState<Record<string, unknown>>({});
  const [jobs, setJobs] = useState<readonly SystemJobRow[]>([]);
  const [audit, setAudit] = useState<readonly SystemAuditRow[]>([]);
  const [objects, setObjects] = useState<SystemObjects>(EMPTY_OBJECTS);
  const [operationError, setOperationError] = useState('');
  const [retryingJob, setRetryingJob] = useState<string>();
  const [retryingPublication, setRetryingPublication] = useState<string>();
  const retryingJobRef = useRef<string | undefined>(undefined);
  const retryingPublicationRef = useRef<string | undefined>(undefined);
  const [section, setSection] = useState<SystemSection>('status');
  const { success } = useAdminToast();

  const loadHealth = useCallback(async () => {
    const next = await apiRequest<unknown>('/api/v1/admin/health');
    setHealth(z.record(z.string(), z.unknown()).parse(next));
  }, []);
  const loadJobs = useCallback(async () => {
    const next = await apiRequest<unknown>('/api/v1/admin/jobs');
    setJobs(z.array(z.record(z.string(), z.string().nullable())).parse(next));
  }, []);
  const loadObjects = useCallback(async () => {
    setObjects(await apiRequest<SystemObjects>('/api/v1/admin/system-objects'));
  }, []);
  const loadAudit = useCallback(async () => {
    const next = await apiRequest<unknown>('/api/v1/admin/audit');
    setAudit(z.array(z.record(z.string(), z.string().nullable())).parse(next));
  }, []);

  /*
   * Only the section on screen is fetched. The others keep whatever they last
   * loaded, so coming back to one is instant.
   */
  const refresh = useCallback(async () => {
    if (section === 'status') await loadHealth();
    else if (section === 'jobs') await loadJobs();
    else if (section === 'objects') await loadObjects();
    else if (section === 'audit') await loadAudit();
  }, [loadAudit, loadHealth, loadJobs, loadObjects, section]);

  const { error: refreshError, isInitialLoading, refreshNow } = useAdminPolling(refresh, 7_500);

  const retryJob = (jobId: string): void => {
    if (retryingJobRef.current !== undefined) return;
    retryingJobRef.current = jobId;
    setRetryingJob(jobId);
    setOperationError('');
    void (async () => {
      try {
        await apiRequest(`/api/v1/admin/jobs/${encodeURIComponent(jobId)}/retry`, {
          method: 'POST',
          body: '{}',
        });
        success('自動処理の再試行を予約しました。');
        await refreshNow();
      } catch (caught) {
        setOperationError(
          caught instanceof Error ? caught.message : '自動処理を再試行できません。',
        );
      } finally {
        retryingJobRef.current = undefined;
        setRetryingJob(undefined);
      }
    })();
  };

  const retryPublication = (publicationId: string): void => {
    if (retryingPublicationRef.current !== undefined) return;
    retryingPublicationRef.current = publicationId;
    setRetryingPublication(publicationId);
    setOperationError('');
    void (async () => {
      try {
        await apiRequest(
          `/api/v1/admin/object-publications/${encodeURIComponent(publicationId)}/retry`,
          { method: 'POST', body: '{}' },
        );
        success('公開データの再試行を予約しました。');
        await refreshNow();
      } catch (caught) {
        setOperationError(
          caught instanceof Error ? caught.message : '公開データを再試行できません。',
        );
      } finally {
        retryingPublicationRef.current = undefined;
        setRetryingPublication(undefined);
      }
    })();
  };

  return (
    <div className="admin-page">
      <AdminTabList
        label="システムメニュー"
        tabs={SYSTEM_SECTIONS}
        selected={section}
        onSelect={setSection}
        idPrefix="system-tab"
        panelId="system-panel"
        className="admin-subnav admin-subnav--wide"
      />
      {refreshError === undefined ? null : (
        <p className="field-error" role="alert">
          {refreshError} システム情報を更新できません。
        </p>
      )}
      {operationError === '' ? null : (
        <p className="field-error" role="alert">
          {operationError}
        </p>
      )}
      <div id="system-panel" role="tabpanel" aria-labelledby={`system-tab-${section}`} tabIndex={0}>
        {section === 'settings' ? (
          <SettingsAdmin />
        ) : section === 'administrators' ? (
          <AdministratorAdmin />
        ) : section === 'status' ? (
          <SystemStatusPanel health={health} isInitialLoading={isInitialLoading} />
        ) : section === 'objects' ? (
          <SystemObjectsPanel
            objects={objects}
            retryingPublication={retryingPublication}
            onRetryPublication={retryPublication}
          />
        ) : section === 'jobs' ? (
          <SystemJobsPanel
            jobs={jobs}
            isInitialLoading={isInitialLoading}
            retryingJob={retryingJob}
            onRetryJob={retryJob}
          />
        ) : (
          <SystemAuditPanel audit={audit} isInitialLoading={isInitialLoading} />
        )}
      </div>
    </div>
  );
}

/**
 * The readings speak for themselves. A summary word above them only says the
 * same thing again, less precisely.
 */
function SystemStatusPanel({
  health,
  isInitialLoading,
}: {
  readonly health: Record<string, unknown>;
  readonly isInitialLoading: boolean;
}) {
  return (
    <TerminalPanel heading="システム状態">
      {isInitialLoading ? null : <SystemHealthReadout health={health} />}
    </TerminalPanel>
  );
}
