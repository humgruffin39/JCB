export type AdminStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const RACE_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: '下書き',
  locked: '確定済み',
  simulating: 'シミュレーション中',
  betting_open: '投票受付中',
  betting_closed: '投票締切',
  ready: '発走待ち',
  running: 'レース中',
  finished: 'レース終了',
  settling: '精算中',
  settled: '精算済み',
  cancelled: '中止',
  failed: '要対応',
};

const RACE_STATUS_TONES: Readonly<Record<string, AdminStatusTone>> = {
  draft: 'neutral',
  locked: 'info',
  simulating: 'info',
  betting_open: 'success',
  betting_closed: 'neutral',
  ready: 'info',
  running: 'success',
  finished: 'neutral',
  settling: 'warning',
  settled: 'success',
  cancelled: 'neutral',
  failed: 'danger',
};

const KIND_LABELS: Readonly<Record<string, string>> = {
  regular: '通常レース',
  midweek: '平日レース',
  saturday_night: '土曜夜レース',
};

const PROCESS_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: '待機中',
  running: '実行中',
  completed: '完了',
  failed: '失敗',
  retry_wait: '再試行待ち',
  dead_letter: '停止中',
};

const JOB_TYPE_LABELS: Readonly<Record<string, string>> = {
  simulate_race: 'レースのシミュレーション',
  publish_race: 'レース情報の公開',
  refresh_race_message: 'レース情報の更新',
  open_viewer: '観戦ページの公開',
  close_betting: '投票受付の締切',
  mark_running: 'レース開始',
  mark_finished: 'レース終了',
  settle_race: 'レース精算',
  grant_relief: '救済配布',
  economic_integrity_check: '残高整合性の確認',
  warn_missing_race: 'レース未作成の確認',
  refresh_rankings: 'ランキング更新',
  backup_check: 'バックアップの確認',
};

const ACCOUNT_TYPE_LABELS: Readonly<Record<string, string>> = {
  user: '利用者',
  central_bank: '中央銀行',
  issuance: '発行',
  burn: '償却',
  race_win_pool: '単勝プール',
  race_trifecta_pool: '三連単プール',
  trifecta_carryover: '三連単キャリーオーバー',
};

const BET_STATUS_LABELS: Readonly<Record<string, string>> = {
  open: '受付中',
  won: '的中',
  lost: '外れ',
  refunded: '返金済み',
};

const HORSE_STATUS_LABELS: Readonly<Record<string, string>> = {
  active: '出走可',
  resting: '休養中',
  retired: '引退',
};

const CONDITION_LABELS: Readonly<Record<string, string>> = {
  terrible: '絶不調',
  poor: '不調',
  normal: '普通',
  good: '好調',
  excellent: '絶好調',
};

const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  'horse.created': '馬を登録',
  'horse.updated': '馬を更新',
  'race.created': 'レース下書きを作成',
  'race.updated': 'レース下書きを更新',
  'race.locked': 'レースを確定',
  'race.unlocked': 'レースを下書きへ戻す',
  'race.cancelled': 'レースを中止',
  'race.simulation_retry_queued': 'シミュレーションを再試行',
  'race.settlement_retry_queued': '精算を再試行',
  'race.rehearsal_completed_now': 'リハーサルを実行',
  'race.emergency_revealed': '緊急結果閲覧を実行',
  'job.retry_queued': '自動処理を再試行',
  'job.dead_lettered': '自動処理を停止',
  'object_publication.retry_queued': '公開データを再試行',
  'ledger.adjusted': '台帳残高を補正',
  'administrator.added': '管理者を追加',
  'administrator.removed': '管理者を削除',
  'setting.updated': '運用設定を更新',
};

const AUDIT_TARGET_LABELS: Readonly<Record<string, string>> = {
  horse: '馬',
  race: 'レース',
  app_setting: '運用設定',
  ledger: '台帳',
  administrator: '管理者',
  job: '自動処理',
  object_publication: '公開データ',
};

const REFERENCE_TYPE_LABELS: Readonly<Record<string, string>> = {
  account: '口座',
  bet: '馬券',
  pool: '投票プール',
  race: 'レース',
  system: 'システム',
  user: '利用者',
};

export function raceStatusLabel(status: string): string {
  return RACE_STATUS_LABELS[status] ?? '状態を確認してください';
}

export function raceStatusTone(status: string): AdminStatusTone {
  return RACE_STATUS_TONES[status] ?? 'warning';
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? 'レース';
}

export function processStatusLabel(status: string | null | undefined): string {
  if (status === null || status === undefined || status === '') return '未作成';
  return PROCESS_STATUS_LABELS[status] ?? '状態を確認してください';
}

export function jobTypeLabel(jobType: string): string {
  return JOB_TYPE_LABELS[jobType] ?? '未登録の自動処理';
}

export function accountTypeLabel(accountType: string): string {
  return ACCOUNT_TYPE_LABELS[accountType] ?? 'その他の口座';
}

export function poolTypeLabel(poolType: string): string {
  return poolType === 'trifecta' ? '三連単' : poolType === 'win' ? '単勝' : 'その他';
}

export function betStatusLabel(status: string): string {
  return BET_STATUS_LABELS[status] ?? '状態を確認してください';
}

export function horseStatusLabel(status: string): string {
  return HORSE_STATUS_LABELS[status] ?? '状態を確認してください';
}

export function conditionLabel(condition: string | null | undefined): string {
  if (condition === null || condition === undefined || condition === '') return '未抽選';
  return CONDITION_LABELS[condition] ?? '状態を確認してください';
}

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? '管理操作';
}

export function auditTargetLabel(targetType: string): string {
  return AUDIT_TARGET_LABELS[targetType] ?? '対象';
}

export function referenceTypeLabel(referenceType: string): string {
  return REFERENCE_TYPE_LABELS[referenceType] ?? 'その他';
}

export function booleanLabel(value: unknown): string {
  return value === true ? '正常' : value === false ? '異常' : String(value);
}
