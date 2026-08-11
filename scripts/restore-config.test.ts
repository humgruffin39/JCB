import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('container restore scripts', () => {
  it('use the rendered Litestream configuration created by the entrypoint', async () => {
    const [backupScript, drillScript] = await Promise.all([
      readFile(new URL('./restore-backup.sh', import.meta.url), 'utf8'),
      readFile(new URL('./restore-drill.sh', import.meta.url), 'utf8'),
    ]);

    expect(backupScript).toContain('-config /tmp/litestream.yml');
    expect(drillScript).toContain('-config /tmp/litestream.yml');
    expect(`${backupScript}\n${drillScript}`).not.toContain('-config /etc/litestream.yml');
  });
});
