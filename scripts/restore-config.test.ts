import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('container restore scripts', () => {
  it('use the rendered Litestream configuration created by the entrypoint', async () => {
    const [backupScript, drillScript, entrypoint] = await Promise.all([
      readFile(new URL('./restore-backup.sh', import.meta.url), 'utf8'),
      readFile(new URL('./restore-drill.sh', import.meta.url), 'utf8'),
      readFile(new URL('../deploy/entrypoint.sh', import.meta.url), 'utf8'),
    ]);

    expect(backupScript).toContain('-config /tmp/litestream.yml');
    expect(drillScript).toContain('-config /tmp/litestream.yml');
    expect(entrypoint).toContain('ALLOW_EMPTY_DATABASE_BOOTSTRAP');
    expect(entrypoint).toContain('-if-replica-exists');
    expect(`${backupScript}\n${drillScript}`).not.toContain('-config /etc/litestream.yml');
  });
});
