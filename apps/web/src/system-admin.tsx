import { TerminalPanel } from '@jcb/ui';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { apiRequest } from './api.js';
import { SettingsAdmin } from './settings-admin.js';
import { AdministratorAdmin } from './administrator-admin.js';

export function SystemAdmin() {
  const [health, setHealth] = useState<Record<string, unknown>>({});
  const [jobs, setJobs] = useState<readonly Record<string, string | null>[]>([]);
  const [audit, setAudit] = useState<readonly Record<string, string | null>[]>([]);
  const [objects, setObjects] = useState<{
    readonly discordMessages: readonly Record<string, string | number | null>[];
    readonly timelineObjects: readonly Record<string, string | number | null>[];
  }>({ discordMessages: [], timelineObjects: [] });
  const refresh = useCallback(async () => {
    const [nextHealth, nextJobs, nextAudit, nextObjects] = await Promise.all([
      apiRequest<unknown>('/api/v1/admin/health'),
      apiRequest<unknown>('/api/v1/admin/jobs'),
      apiRequest<unknown>('/api/v1/admin/audit'),
      apiRequest<typeof objects>('/api/v1/admin/system-objects'),
    ]);
    setHealth(z.record(z.string(), z.unknown()).parse(nextHealth));
    setJobs(z.array(z.record(z.string(), z.string().nullable())).parse(nextJobs));
    setAudit(z.array(z.record(z.string(), z.string().nullable())).parse(nextAudit));
    setObjects(nextObjects);
  }, []);
  useEffect(() => void refresh(), [refresh]);
  const systemNominal =
    health.ledgerProjectionValid === true &&
    health.databaseReadWrite === true &&
    health.memoryStatus !== 'failure' &&
    health.schedulerStatus !== 'failure' &&
    health.r2AccessStatus !== 'failure' &&
    health.discordGatewayConnected === true &&
    Number(health.deadJobs ?? 0) === 0;

  const retryJob = (jobId: string): void => {
    void (async () => {
      await apiRequest(`/api/v1/admin/jobs/${encodeURIComponent(jobId)}/retry`, {
        method: 'POST',
        body: '{}',
      });
      await refresh();
    })();
  };

  return (
    <div className="system-layout">
      <SettingsAdmin />
      <AdministratorAdmin />
      <TerminalPanel heading="システム状態" status={systemNominal ? '正常' : '要確認'}>
        <dl className="metric-list">
          {Object.entries(health).map(([key, value]) => (
            <div key={key}>
              <dt>{HEALTH_LABELS[key] ?? key}</dt>
              <dd>{formatHealthValue(key, value)}</dd>
            </div>
          ))}
        </dl>
      </TerminalPanel>
      <TerminalPanel
        heading="Discord固定メッセージ"
        status={`${String(objects.discordMessages.length)}件`}
      >
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>用途</th>
                <th>レース</th>
                <th>チャンネルID</th>
                <th>メッセージID</th>
                <th>更新</th>
              </tr>
            </thead>
            <tbody>
              {objects.discordMessages.map((row) => (
                <tr key={String(row.id)}>
                  <td>{String(row.purpose)}</td>
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
        heading="R2 timeline objects"
        status={`${String(objects.timelineObjects.length)}件`}
      >
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>レース</th>
                <th>version</th>
                <th>状態</th>
                <th>object key</th>
                <th>SHA-256</th>
                <th>完了</th>
              </tr>
            </thead>
            <tbody>
              {objects.timelineObjects.map((row, index) => (
                <tr key={`${String(row.raceId)}-${String(row.raceVersion)}-${String(index)}`}>
                  <td>{String(row.raceName)}</td>
                  <td>{String(row.raceVersion)}</td>
                  <td>{String(row.status)}</td>
                  <td>{String(row.objectKey)}</td>
                  <td>{String(row.sha256)}</td>
                  <td>{formatTimestamp(row.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TerminalPanel>
      <TerminalPanel heading="ジョブキュー" status={`${String(jobs.length)}件`}>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>種別</th>
                <th>状態</th>
                <th>試行</th>
                <th>エラー</th>
                <th>
                  <span className="visually-hidden">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const jobId = job.id;
                return (
                  <tr key={jobId}>
                    <td>{job.jobType}</td>
                    <td>{job.status}</td>
                    <td>{job.attemptCount}</td>
                    <td>{job.lastErrorCode ?? '—'}</td>
                    <td>
                      {typeof jobId === 'string' &&
                      (job.status === 'dead_letter' || job.status === 'retry_wait') ? (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => retryJob(jobId)}
                        >
                          再試行する
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
      <TerminalPanel heading="監査ログ" status="追記専用">
        <ul className="audit-list">
          {audit.slice(0, 100).map((row) => (
            <li key={row.id}>
              <time>{row.createdAt}</time>
              <strong>{row.action}</strong>
              <span>
                {row.targetType}:{row.targetId}
              </span>
              <small>{row.reason ?? ''}</small>
            </li>
          ))}
        </ul>
      </TerminalPanel>
    </div>
  );
}

function formatHealthValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '未記録';
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
  if (key === 'medianUserPoolByRaceKind' && typeof value === 'object' && value !== null) {
    return Object.entries(value)
      .map(([kind, amount]) => `${kind}: ${formatRupees(String(amount))}`)
      .join(' / ');
  }
  if (key.toLowerCase().endsWith('at') && typeof value === 'string') {
    return formatTimestamp(value);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const HEALTH_LABELS: Readonly<Record<string, string>> = {
  databaseReadWrite: 'DB read/write',
  ledgerProjectionValid: '台帳projection整合',
  centralBankBalance: '中央銀行残高',
  allAccountBalanceTotal: '全口座残高合計',
  userBalanceTotal: 'ユーザー残高合計',
  poolBalanceTotal: 'pool残高合計',
  carryoverBalance: 'carryover残高',
  seedLiquidityProfitLoss: 'seed liquidity損益',
  reliefGrantedTotal: '救済給付合計',
  medianUserPoolByRaceKind: 'レース種別pool中央値',
  topTwentyPercentShareBasisPoints: '上位20%残高占有率',
  thirtyDayMovementTotal: '30日間の通貨移動量',
  lastBackupSuccessAt: '最終backup成功',
  lastRestoreDrillAt: '最終restore drill',
  schedulerHeartbeatAt: 'scheduler heartbeat',
  schedulerStatus: 'scheduler状態',
  r2LastAccessAt: '最終R2アクセス',
  r2AccessStatus: 'R2アクセス状態',
  discordMessageCount: 'Discord固定メッセージ数',
  timelineObjectCount: 'timeline object数',
  pendingJobs: '未処理job',
  deadJobs: 'dead letter',
  applicationVersion: 'application version',
  simulationVersion: 'simulation version',
  oddsVersion: 'odds version',
  residentSetBytes: 'RSS',
  memoryStatus: 'メモリ状態',
  discordGatewayConnected: 'Discord gateway接続',
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
