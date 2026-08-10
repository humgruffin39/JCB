import { verifyBackupProbe } from './scheduler.js';

describe('backup health probe', () => {
  it('records successful R2 access before reporting a missing first backup', async () => {
    const recorded: Array<readonly [string, string]> = [];
    await expect(
      verifyBackupProbe(
        { latestBackupAt: async () => undefined },
        1_800_000_000_000,
        (key, value) => recorded.push([key, value]),
      ),
    ).rejects.toThrow(/65 minutes/);
    expect(recorded).toEqual([['last_r2_access_at', new Date(1_800_000_000_000).toISOString()]]);
  });

  it('records both R2 access and a fresh backup', async () => {
    const checkedAt = 1_800_000_000_000;
    const latest = checkedAt - 60 * 60 * 1_000;
    const recorded: Array<readonly [string, string]> = [];
    await verifyBackupProbe({ latestBackupAt: async () => latest }, checkedAt, (key, value) =>
      recorded.push([key, value]),
    );
    expect(recorded).toEqual([
      ['last_r2_access_at', new Date(checkedAt).toISOString()],
      ['last_backup_success_at', new Date(latest).toISOString()],
    ]);
  });
});
