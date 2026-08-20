import { buildAdminNoticeMessage, type AdminNotice } from './admin-notification.js';
import type { SchedulerDependencies } from './scheduler-types.js';

export async function sendAdminNotice(
  dependencies: SchedulerDependencies,
  notice: AdminNotice,
): Promise<void> {
  if (
    dependencies.discordClient === undefined ||
    dependencies.environment.DISCORD_ADMIN_CHANNEL_ID === undefined
  ) {
    return;
  }
  const channel = await dependencies.discordClient.channels.fetch(
    dependencies.environment.DISCORD_ADMIN_CHANNEL_ID,
  );
  if (channel !== null && channel.isSendable()) {
    await channel.send(buildAdminNoticeMessage(notice));
  }
}

export function formatJobType(jobType: string): string {
  const labels: Readonly<Record<string, string>> = {
    simulate_race: 'レースのシミュレーション',
    publish_race: 'レース情報の公開',
    grant_racing_role: '競馬参加者ロールの付与',
    notify_race_start: 'レース開始5分前の通知',
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
    restore_drill: 'バックアップの復旧テスト',
  };
  return labels[jobType] ?? '未登録の自動処理';
}

export function nextMonthKey(month: string): string {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(monthNumber) ||
    monthNumber < 1 ||
    monthNumber > 12
  ) {
    throw new Error('Invalid restore drill month.');
  }
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}

export function runtimeSecrets(
  value: string | undefined,
  previousValue: string | undefined,
  nodeEnvironment: string,
): readonly string[] {
  if (value !== undefined) {
    return previousValue === undefined || previousValue === value
      ? [value]
      : [value, previousValue];
  }
  if (nodeEnvironment === 'production')
    throw new Error('Required cryptographic secret is missing.');
  return [Buffer.alloc(32, 7).toString('base64')];
}

export function requireConfigured(
  value: string | undefined,
  key: string,
  nodeEnvironment: string,
): string {
  if (value !== undefined) return value;
  if (nodeEnvironment === 'production') throw new Error(`${key} is missing.`);
  throw new Error(`${key} is required to simulate a race in development.`);
}

export function cryptoJitter(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0]! / 4_294_967_296;
}
