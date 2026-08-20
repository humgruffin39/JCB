import { booleanLabel } from './admin-labels.js';

export function SystemHealthReadout({ health }: { readonly health: Record<string, unknown> }) {
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
        const headingId = `health-${heading}`;
        return (
          <section key={heading} className="health-group" aria-labelledby={headingId}>
            <h3 id={headingId}>{heading}</h3>
            <HealthMetrics entries={entries} />
          </section>
        );
      })}
      {Object.entries(health).some(([key]) => !shownKeys.has(key)) ? (
        <section className="health-group" aria-labelledby="health-other">
          <h3 id="health-other">その他</h3>
          <HealthMetrics entries={Object.entries(health).filter(([key]) => !shownKeys.has(key))} />
        </section>
      ) : null}
    </div>
  );
}

function HealthMetrics({ entries }: { readonly entries: readonly (readonly [string, unknown])[] }) {
  return (
    <dl className="metric-list">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{HEALTH_LABELS[key] ?? key}</dt>
          <dd>{formatHealthValue(key, value)}</dd>
        </div>
      ))}
    </dl>
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
    return `${BigInt(value).toLocaleString('ja-JP')} CP`;
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
  return /^-?\d+$/.test(value) ? `${BigInt(value).toLocaleString('ja-JP')} CP` : value;
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
