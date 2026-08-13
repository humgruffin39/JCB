import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteAuthStore } from './auth-store.js';
import { openDatabase } from './connection.js';
import { SqliteMaintenanceStore } from './maintenance-store.js';
import { applyMigrations } from './migrations.js';

describe('database retention maintenance', () => {
  it('removes expired authentication records after their recovery window', () => {
    let now = 0;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    const auth = new SqliteAuthStore(database, () => now);
    auth.issueLoginTicket('user');
    auth.issueOAuthState();
    auth.createOAuthSession('user');
    // Seed an old session explicitly so this retention test does not depend on
    // the configured lifetime of newly issued OAuth sessions.
    database
      .prepare('UPDATE web_sessions SET expires_at = ? WHERE discord_user_id = ?')
      .run(BigInt(now), 'user');
    now = 61 * 24 * 60 * 60 * 1_000;

    const result = new SqliteMaintenanceStore(database).cleanup(now);
    expect(result.expiredLoginTickets).toBe(1);
    expect(result.expiredOAuthStates).toBe(1);
    expect(result.expiredWebSessions).toBe(1);
    database.close();
  });
});
