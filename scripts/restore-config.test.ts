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

  it('keeps production backup operations within the intended cadence', async () => {
    const config = await readFile(new URL('../deploy/litestream.yml', import.meta.url), 'utf8');

    expect(config).toContain('levels:\n  - interval: 5m\n  - interval: 1h\n  - interval: 24h');
    expect(config).toContain('l0-retention-check-interval: 5m');
    expect(config).toContain('snapshot:\n  interval: 24h\n  retention: 720h');
    expect(config).toContain('checkpoint-interval: 5m');
    expect(config).toContain('sync-interval: 5m');
    expect(config).not.toContain('verify-compaction: true');
  });
});
