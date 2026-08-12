import { TerminalPanel } from '@jcb/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  auditActionLabel,
  auditTargetLabel,
  booleanLabel,
  jobTypeLabel,
  processStatusLabel,
} from './admin-labels.js';
import { apiRequest } from './api.js';
import { SettingsAdmin } from './settings-admin.js';
import { AdministratorAdmin } from './administrator-admin.js';
import { useAdminPolling } from './use-admin-polling.js';

type SystemSection = 'status' | 'jobs' | 'objects' | 'settings' | 'administrators' | 'audit';

export function SystemAdmin() {
  const [health, setHealth] = useState<Record<string, unknown>>({});
  const [jobs, setJobs] = useState<readonly Record<string, string | null>[]>([]);
  const [audit, setAudit] = useState<readonly Record<string, string | null>[]>([]);
  const [objects, setObjects] = useState<{
    readonly discordMessages: readonly Record<string, string | number | null>[];
    readonly timelineObjects: readonly Record<string, string | number | null>[];
    readonly objectPublications: readonly Record<string, string | number | null>[];
  }>({ discordMessages: [], timelineObjects: [], objectPublications: [] });
  const [operationError, setOperationError] = useState('');
  const [retryingJob, setRetryingJob] = useState<string>();
  const [retryingPublication, setRetryingPublication] = useState<string>();
  const [section, setSection] = useState<SystemSection>('status');
  const previousSection = useRef(section);
  const refresh = useCallback(async () => {
    if (section === 'status') {
      const nextHealth = await apiRequest<unknown>('/api/v1/admin/health');
      setHealth(z.record(z.string(), z.unknown()).parse(nextHealth));
    } else if (section === 'jobs') {
      const nextJobs = await apiRequest<unknown>('/api/v1/admin/jobs');
      setJobs(z.array(z.record(z.string(), z.string().nullable())).parse(nextJobs));
    } else if (section === 'objects') {
      setObjects(await apiRequest<typeof objects>('/api/v1/admin/system-objects'));
    } else if (section === 'audit') {
      const nextAudit = await apiRequest<unknown>('/api/v1/admin/audit');
      setAudit(z.array(z.record(z.string(), z.string().nullable())).parse(nextAudit));
    }
  }, [section]);
  const { error: refreshError, isInitialLoading, refreshNow } = useAdminPolling(refresh, 7_500);

  useEffect(() => {
    if (previousSection.current === section) return;
    previousSection.current = section;
    void refreshNow().catch(() => undefined);
  }, [refreshNow, section]);
  const systemNominal =
    health.ledgerProjectionValid === true &&
    health.databaseReadWrite === true &&
    health.memoryStatus !== 'failure' &&
    health.schedulerStatus !== 'failure' &&
    health.r2AccessStatus !== 'failure' &&
    health.discordGatewayConnected === true &&
    Number(health.deadJobs ?? 0) === 0 &&
    Number(health.deadObjectPublications ?? 0) === 0;

  const retryJob = (jobId: string): void => {
    if (retryingJob !== undefined) return;
    setRetryingJob(jobId);
    setOperationError('');
    void (async () => {
      try {
        await apiRequest(`/api/v1/admin/jobs/${encodeURIComponent(jobId)}/retry`, {
          method: 'POST',
          body: '{}',
        });
        await refreshNow();
      } catch (caught) {
        setOperationError(
          caught instanceof Error ? caught.message : '自動処理を再試行できません。',
        );
      } finally {
        setRetryingJob(undefined);
      }
    })();
  };

  const retryPublication = (publicationId: string): void => {
    if (retryingPublication !== undefined) return;
    setRetryingPublication(publicationId);
    setOperationError('');
    void (async () => {
      try {
        await apiRequest(
          `/api/v1/admin/object-publications/${encodeURIComponent(publicationId)}/retry`,
          { method: 'POST', body: '{}' },
        );
        await refreshNow();
      } catch (caught) {
        setOperationError(
          caught instanceof Error ? caught.message : '公開データを再試行できません。',
        );
      } finally {
        setRetryingPublication(undefined);
      }
    })();
  };

  const sections = [
    ['status', '状態'],
    ['jobs', '自動処理'],
    ['objects', '公開データ'],
    ['settings', '運用設定'],
    ['administrators', '管理者'],
    ['audit', '監査ログ'],
  ] as const;

  return (
    <div className="admin-page">
      <nav className="admin-subnav admin-subnav--wide" aria-label="システムメニュー" role="tablist">
        {sections.map(([value, label]) => (
          <button
            key={value}
            id={`system-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={section === value}
            aria-controls="system-panel"
            onClick={() => setSection(value)}
          >
            {label}
          </button>
        ))}
      </nav>
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
          <TerminalPanel
            heading="システム状態"
            status={isInitialLoading ? '読み込み中' : systemNominal ? '正常' : '要確認'}
          >
            {isInitialLoading ? (
              <p role="status" aria-live="polite">
                システム情報を読み込んでいます。
              </p>
            ) : (
              <HealthReadout health={health} />
            )}
          </TerminalPanel>
        ) : section === 'objects' ? (
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
            <TerminalPanel
              heading="観戦データ"
              status={`${String(objects.timelineObjects.length)}件`}
            >
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
                        <td>
                          {processStatusLabel(typeof row.status === 'string' ? row.status : null)}
                        </td>
                        <td>{String(row.objectKey)}</td>
                        <td>{String(row.sha256)}</td>
                        <td>{formatTimestamp(row.completedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TerminalPanel>
            <TerminalPanel
              heading="公開outbox"
              status={`${String(objects.objectPublications.length)}件`}
            >
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
                                onClick={() => retryPublication(publicationId)}
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
        ) : section === 'jobs' ? (
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
                              onClick={() => retryJob(jobId)}
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
        ) : (
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
        )}
      </div>
    </div>
  );
}

function HealthReadout({ health }: { readonly health: Record<string, unknown> }) {
  const shownKeys = new Set<string>();
  return (
    <div className="health-groups">
      {HEALTH_GROUPS.map(({ heading, keys }) => {
        const entries = keys
          .filter((key) => Object.hasOwn(health, key))
          .map((key) => {
            shownKeys.add(key);
            return [key, health[key]] as const;
          });
        if (entries.length === 0) return null;
        return (
          <section key={heading} className="health-group" aria-labelledby={`health-${heading}`}>
            <h3 id={`health-${heading}`}>{heading}</h3>
            <dl className="metric-list">
              {entries.map(([key, value]) => (
                <div key={key}>
                  <dt>{HEALTH_LABELS[key] ?? key}</dt>
                  <dd>{formatHealthValue(key, value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
      {Object.entries(health).some(([key]) => !shownKeys.has(key)) ? (
        <section className="health-group" aria-labelledby="health-other">
          <h3 id="health-other">その他</h3>
          <dl className="metric-list">
            {Object.entries(health)
              .filter(([key]) => !shownKeys.has(key))
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{HEALTH_LABELS[key] ?? key}</dt>
                  <dd>{formatHealthValue(key, value)}</dd>
                </div>
              ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

const HEALTH_GROUPS = [
  {
    heading: '接続・稼働',
    keys: [
      'databaseReadWrite',
      'discordGatewayConnected',
      'schedulerStatus',
      'r2AccessStatus',
      'memoryStatus',
    ],
  },
  {
    heading: '台帳・残高',
    keys: [
      'ledgerProjectionValid',
      'centralBankBalance',
      'allAccountBalanceTotal',
      'userBalanceTotal',
      'poolBalanceTotal',
      'carryoverBalance',
      'seedLiquidityProfitLoss',
      'reliefGrantedTotal',
      'medianUserPoolByRaceKind',
      'topTwentyPercentShareBasisPoints',
      'thirtyDayMovementTotal',
    ],
  },
  {
    heading: 'バックアップ・保存',
    keys: ['lastBackupSuccessAt', 'lastRestoreDrillAt', 'schedulerHeartbeatAt', 'r2LastAccessAt'],
  },
  {
    heading: 'アプリケーション',
    keys: [
      'pendingJobs',
      'deadJobs',
      'deadObjectPublications',
      'discordMessageCount',
      'timelineObjectCount',
      'applicationVersion',
      'simulationVersion',
      'oddsVersion',
      'residentSetBytes',
    ],
  },
] as const;

function formatHealthValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '未記録';
  if (typeof value === 'boolean') return booleanLabel(value);
  if (
    [
      'centralBankBalance',
      'allAccountBalanceTotal',
      'userBalanceTotal',
      'poolBalanceTotal',
      'carryoverBalance',
      'seedLiquidityProfitLoss',
      'reliefGrantedTotal',
      'thirtyDayMovementTotal',
    ].includes(key) &&
    typeof value === 'string' &&
    /^-?\d+$/.test(value)
  ) {
    return `${BigInt(value).toLocaleString('ja-JP')} R`;
  }
  if (key === 'topTwentyPercentShareBasisPoints' && typeof value === 'number') {
    return `${(value / 100).toFixed(1)}%`;
  }
  if (key === 'residentSetBytes' && typeof value === 'number') {
    return `${(value / 1_024 / 1_024).toFixed(1)} MiB`;
  }
  if (key === 'schedulerStatus' || key === 'r2AccessStatus') {
    return value === 'nominal' ? '正常' : '異常';
  }
  if (key === 'memoryStatus') {
    return value === 'nominal' ? '正常' : value === 'warning' ? '注意' : '異常';
  }
  if (key === 'medianUserPoolByRaceKind' && typeof value === 'object' && value !== null) {
    return Object.entries(value)
      .map(([kind, amount]) => `${raceKindLabel(kind)}: ${formatRupees(String(amount))}`)
      .join(' / ');
  }
  if (key.toLowerCase().endsWith('at') && typeof value === 'string') {
    return formatTimestamp(value);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const HEALTH_LABELS: Readonly<Record<string, string>> = {
  databaseReadWrite: 'データベース読み書き',
  ledgerProjectionValid: '台帳の整合性',
  centralBankBalance: '中央銀行残高',
  allAccountBalanceTotal: '全口座残高合計',
  userBalanceTotal: 'ユーザー残高合計',
  poolBalanceTotal: '投票プール残高合計',
  carryoverBalance: 'キャリーオーバー残高',
  seedLiquidityProfitLoss: '初期流動性の損益',
  reliefGrantedTotal: '救済給付合計',
  medianUserPoolByRaceKind: 'レース種別ごとの投票プール中央値',
  topTwentyPercentShareBasisPoints: '上位20%残高占有率',
  thirtyDayMovementTotal: '30日間の通貨移動量',
  lastBackupSuccessAt: '最終バックアップ成功',
  lastRestoreDrillAt: '最終復旧訓練',
  schedulerHeartbeatAt: '自動処理の最終応答',
  schedulerStatus: '自動処理の状態',
  r2LastAccessAt: '最終観戦データアクセス',
  r2AccessStatus: '観戦データアクセス状態',
  discordMessageCount: 'Discord固定メッセージ数',
  timelineObjectCount: '観戦データ数',
  pendingJobs: '未処理の自動処理',
  deadJobs: '停止中の自動処理',
  deadObjectPublications: '停止中の公開処理',
  applicationVersion: 'アプリケーション版',
  simulationVersion: 'シミュレーション版',
  oddsVersion: 'オッズ版',
  residentSetBytes: 'メモリ使用量',
  memoryStatus: 'メモリ状態',
  discordGatewayConnected: 'Discord接続',
};

function formatRupees(value: string): string {
  return /^-?\d+$/.test(value) ? `${BigInt(value).toLocaleString('ja-JP')} R` : value;
}

function formatTimestamp(value: unknown): string {
  const numeric = Number(value);
  const milliseconds =
    Number.isFinite(numeric) && numeric > 0 ? numeric : Date.parse(String(value));
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? new Date(milliseconds).toLocaleString('ja-JP')
    : '未記録';
}

function raceKindLabel(kind: string): string {
  return kind === 'midweek' ? '平日' : kind === 'saturday_night' ? '土曜夜' : '通常';
}

function discordPurposeLabel(purpose: string): string {
  if (purpose === 'race') return 'レース告知';
  if (purpose.startsWith('ranking:')) return `ランキング ${purpose.slice('ranking:'.length)}`;
  return 'その他';
}
