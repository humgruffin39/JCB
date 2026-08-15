import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';

describe('operational query indexes', () => {
  it('backs race-history, open-ticket, and Activity retention scans', () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      0,
    );

    expect(
      planDetails(
        database,
        `SELECT id FROM races
         WHERE kind = ? AND scheduled_at < ?
         ORDER BY scheduled_at DESC LIMIT 14`,
        'regular',
        1_000,
      ),
    ).toContain('races_kind_scheduled_idx');
    expect(
      planDetails(
        database,
        'SELECT id FROM accounts WHERE account_type = ? AND owner_key = ?',
        'user',
        'user-1',
      ),
    ).toContain('accounts_type_owner_idx');
    expect(
      planDetails(
        database,
        `SELECT id FROM bets
         WHERE pool_id = ? AND status = 'open'
         ORDER BY created_at, id`,
        'pool-1',
      ),
    ).toContain('bets_pool_status_created_idx');
    expect(
      planDetails(database, 'DELETE FROM activity_launch_intents WHERE expires_at < ?', 1_000),
    ).toContain('activity_launch_intents_expiry_idx');
    expect(
      planDetails(database, 'DELETE FROM activity_instances WHERE last_verified_at < ?', 1_000),
    ).toContain('activity_instances_last_verified_idx');

    database.close();
  });
});

function planDetails(
  database: ReturnType<typeof openDatabase>,
  sql: string,
  ...parameters: readonly unknown[]
): string {
  const rows = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters) as Array<{
    readonly detail: string;
  }>;
  return rows.map((row) => row.detail).join('\n');
}
