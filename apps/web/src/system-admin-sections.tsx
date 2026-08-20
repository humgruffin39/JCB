import { TerminalPanel } from '@jcb/ui';
import {
  auditActionLabel,
  auditTargetLabel,
  jobTypeLabel,
  processStatusLabel,
} from './admin-labels.js';

export type SystemJobRow = Readonly<Record<string, string | null>>;
export type SystemAuditRow = Readonly<Record<string, string | null>>;
export type SystemObjectRow = Readonly<Record<string, string | number | null>>;

export interface SystemObjects {
  readonly discordMessages: readonly SystemObjectRow[];
  readonly timelineObjects: readonly SystemObjectRow[];
  readonly objectPublications: readonly SystemObjectRow[];
}

export function SystemObjectsPanel({
  objects,
  retryingPublication,
  onRetryPublication,
}: {
  readonly objects: SystemObjects;
  readonly retryingPublication: string | undefined;
  readonly onRetryPublication: (publicationId: string) => void;
}) {
  return (
    <div className="admin-surface-grid">
      <TerminalPanel
        heading="Discord固定メッセージ"
        status={`${String(objects.discordMessages.length)}件`}
      >
        <div className="data-table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Discord固定メッセージ</caption>
            <thead>
              <tr>
                <th scope="col">用途</th>
                <th scope="col">レース</th>
                <th scope="col">チャンネルID</th>
                <th scope="col">メッセージID</th>
                <th scope="col">更新</th>
              </tr>
            </thead>
            <tbody>
              {objects.discordMessages.map((row) => (
                <tr key={String(row.id)}>
                  <td>{discordPurposeLabel(String(row.purpose))}</td>
                  <td>{String(row.raceName ?? 'ランキング')}</td>
                  <td>{String(row.channelId)}</td>
                  <td>{String(row.messageId)}</td>
                  <td>{formatTimestamp(row.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TerminalPanel>
      <TerminalPanel heading="観戦データ" status={`${String(objects.timelineObjects.length)}件`}>
        <div className="data-table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">観戦データ</caption>
            <thead>
              <tr>
                <th scope="col">レース</th>
                <th scope="col">版</th>
                <th scope="col">状態</th>
                <th scope="col">保存キー</th>
                <th scope="col">整合性ハッシュ</th>
                <th scope="col">完了</th>
              </tr>
            </thead>
            <tbody>
              {objects.timelineObjects.map((row, index) => (
                <tr key={`${String(row.raceId)}-${String(row.raceVersion)}-${String(index)}`}>
                  <td>{String(row.raceName)}</td>
                  <td>{String(row.raceVersion)}</td>
                  <td>{processStatusLabel(typeof row.status === 'string' ? row.status : null)}</td>
                  <td>{String(row.objectKey)}</td>
                  <td>{String(row.sha256)}</td>
                  <td>{formatTimestamp(row.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TerminalPanel>
      <TerminalPanel heading="公開outbox" status={`${String(objects.objectPublications.length)}件`}>
        <div className="data-table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">公開outbox</caption>
            <thead>
              <tr>
                <th scope="col">キー</th>
                <th scope="col">状態</th>
                <th scope="col">試行</th>
                <th scope="col">エラー</th>
                <th scope="col">
                  <span className="visually-hidden">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {objects.objectPublications.map((row) => {
                const publicationId = row.id;
                return (
                  <tr key={String(publicationId)}>
                    <td>{String(row.objectKey)}</td>
                    <td>{processStatusLabel(String(row.status))}</td>
                    <td>{String(row.attemptCount)}</td>
                    <td>{String(row.lastError ?? '—')}</td>
                    <td>
                      {typeof publicationId === 'string' && row.status === 'dead_letter' ? (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => onRetryPublication(publicationId)}
                          disabled={retryingPublication !== undefined}
                        >
                          {retryingPublication === publicationId ? '再試行中…' : '再試行する'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TerminalPanel>
    </div>
  );
}

export function SystemJobsPanel({
  jobs,
  retryingJob,
  onRetryJob,
}: {
  readonly jobs: readonly SystemJobRow[];
  readonly retryingJob: string | undefined;
  readonly onRetryJob: (jobId: string) => void;
}) {
  return (
    <TerminalPanel heading="ジョブキュー" status={`${String(jobs.length)}件`}>
      <div className="data-table-wrap">
        <table className="data-table">
          <caption className="visually-hidden">ジョブキュー</caption>
          <thead>
            <tr>
              <th scope="col">種別</th>
              <th scope="col">状態</th>
              <th scope="col">試行</th>
              <th scope="col">エラー</th>
              <th scope="col">
                <span className="visually-hidden">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const jobId = job.id;
              return (
                <tr key={jobId}>
                  <td>{jobTypeLabel(job.jobType ?? '')}</td>
                  <td>{processStatusLabel(job.status)}</td>
                  <td>{job.attemptCount}</td>
                  <td>{job.lastErrorCode ?? '—'}</td>
                  <td>
                    {typeof jobId === 'string' &&
                    (job.status === 'dead_letter' || job.status === 'retry_wait') ? (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => onRetryJob(jobId)}
                        disabled={retryingJob !== undefined}
                      >
                        {retryingJob === jobId ? '再試行中…' : '再試行する'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </TerminalPanel>
  );
}

export function SystemAuditPanel({ audit }: { readonly audit: readonly SystemAuditRow[] }) {
  return (
    <TerminalPanel heading="監査ログ" status="追記専用">
      <ul className="audit-list">
        {audit.slice(0, 100).map((row) => (
          <li key={row.id}>
            <time>{row.createdAt}</time>
            <strong>{auditActionLabel(String(row.action))}</strong>
            <span>
              {auditTargetLabel(String(row.targetType))}：{row.targetId}
            </span>
            <small>{row.reason ?? ''}</small>
          </li>
        ))}
      </ul>
    </TerminalPanel>
  );
}

function formatTimestamp(value: unknown): string {
  const numeric = Number(value);
  const milliseconds =
    Number.isFinite(numeric) && numeric > 0 ? numeric : Date.parse(String(value));
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? new Date(milliseconds).toLocaleString('ja-JP')
    : '未記録';
}

function discordPurposeLabel(purpose: string): string {
  if (purpose === 'race') return 'レース告知';
  if (purpose === 'race_reminder') return 'レース開始通知';
  if (purpose.startsWith('ranking:')) return `ランキング ${purpose.slice('ranking:'.length)}`;
  return 'その他';
}
