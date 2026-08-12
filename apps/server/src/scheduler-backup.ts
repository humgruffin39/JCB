import type { BackupProbe } from './backup-probe.js';

const BACKUP_MAXIMUM_AGE_MILLISECONDS = 65 * 60 * 1_000;

export async function verifyBackupProbe(
  probe: BackupProbe,
  checkedAt: number,
  recordSetting: (key: string, value: string) => void,
): Promise<void> {
  const latest = await probe.latestBackupAt();
  recordSetting('last_r2_access_at', new Date(checkedAt).toISOString());
  if (latest === undefined || checkedAt - latest > BACKUP_MAXIMUM_AGE_MILLISECONDS) {
    throw new Error('No R2 backup object was updated within 65 minutes.');
  }
  recordSetting('last_backup_success_at', new Date(latest).toISOString());
}
