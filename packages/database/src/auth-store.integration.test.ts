import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timestamp } from '@jcb/domain';
import { openDatabase } from './connection.js';
import { SqliteAuthStore } from './auth-store.js';
import { applyMigrations } from './migrations.js';

describe('web authentication store', () => {
  it('stores only hashes, consumes tickets once, checks CSRF, and revokes sessions', () => {
    let now = 1_000;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    const store = new SqliteAuthStore(database, () => now);
    database
      .prepare(
        `INSERT INTO races
         (id, race_date, name, kind, status, version, distance_m, going,
          scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
          created_at, updated_at)
         VALUES ('race-1', '2026-01-01', 'テストレース', 'regular', 'draft', 0, 1200, 'good',
                 1000, 100, 900, 50, 1000, 1000)`,
      )
      .run();
    const issued = store.issueLoginTicket('123456', 'race-1');
    const storedTicket = database
      .prepare('SELECT token_hash AS tokenHash FROM web_login_tickets')
      .get() as { tokenHash: string };
    expect(storedTicket.tokenHash).not.toBe(issued.ticket);
    const exchanged = store.exchangeLoginTicket(issued.ticket);
    expect(() => store.exchangeLoginTicket(issued.ticket)).toThrow();
    expect(store.validateSession(exchanged.sessionToken, exchanged.csrfToken).discordUserId).toBe(
      '123456',
    );
    expect(store.validateSession(exchanged.sessionToken).authenticationMethod).toBe('ticket');
    expect(store.validateSession(exchanged.sessionToken).raceId).toBe('race-1');
    expect(() => store.validateSession(exchanged.sessionToken, 'wrong')).toThrow();
    const rotatedCsrfToken = store.rotateCsrfToken(exchanged.sessionToken);
    expect(() => store.validateSession(exchanged.sessionToken, exchanged.csrfToken)).toThrow();
    expect(store.validateSession(exchanged.sessionToken, rotatedCsrfToken).discordUserId).toBe(
      '123456',
    );
    expect(store.getOrRotateCsrfToken(exchanged.sessionToken, rotatedCsrfToken)).toBe(
      rotatedCsrfToken,
    );
    const recoveredCsrfToken = store.getOrRotateCsrfToken(exchanged.sessionToken, 'stale-token');
    expect(recoveredCsrfToken).not.toBe(rotatedCsrfToken);
    expect(store.validateSession(exchanged.sessionToken, recoveredCsrfToken).discordUserId).toBe(
      '123456',
    );
    store.revoke(exchanged.sessionToken);
    expect(() => store.validateSession(exchanged.sessionToken)).toThrow();
    now += 1;
    database.close();
  });

  it('consumes PKCE OAuth state once and marks the resulting session as OAuth', () => {
    let now = 2_000;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    const store = new SqliteAuthStore(database, () => now);
    const issued = store.issueOAuthState();

    expect(store.consumeOAuthState(issued.state)).toEqual({
      codeVerifier: issued.codeVerifier,
      purpose: 'login',
    });
    expect(() => store.consumeOAuthState(issued.state)).toThrow();
    const session = store.createOAuthSession('987654');
    const validated = store.validateSession(session.sessionToken);
    expect(validated.authenticationMethod).toBe('discord_oauth');
    const reauthentication = store.issueOAuthState('emergency_reauthentication', validated.id);
    expect(store.consumeOAuthState(reauthentication.state)).toEqual({
      codeVerifier: reauthentication.codeVerifier,
      purpose: 'emergency_reauthentication',
      existingSessionId: validated.id,
    });
    store.markReauthenticated(validated.id, '987654', timestamp(now));
    expect(store.validateSession(session.sessionToken).reauthenticatedAt).toBe(now);
    now += 1;
    database.close();
  });

  it('keeps allowlisted OAuth sessions persistent and does not renew removed admins', () => {
    let now = 3_000;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    database
      .prepare(
        `INSERT INTO admin_allowlist (discord_user_id, added_by_user_id, created_at)
         VALUES (?, NULL, ?)`,
      )
      .run('admin-1', BigInt(now));
    const store = new SqliteAuthStore(database, () => now);
    const session = store.createOAuthSession('admin-1');

    expect(session.expiresAt).toBeGreaterThan(now + 365 * 24 * 60 * 60 * 1_000);
    now += 123_000;
    const renewedExpiresAt = store.renewOAuthSession(session.sessionToken);
    expect(renewedExpiresAt).toBeDefined();
    expect(renewedExpiresAt).toBeGreaterThan(now + 365 * 24 * 60 * 60 * 1_000);

    const sessionId = store.validateSession(session.sessionToken).id;
    database
      .prepare('UPDATE web_sessions SET expires_at = ? WHERE id = ?')
      .run(BigInt(now - 1), sessionId);
    expect(store.renewOAuthSession(session.sessionToken)).toBeUndefined();

    database.prepare('DELETE FROM admin_allowlist WHERE discord_user_id = ?').run('admin-1');
    expect(store.renewOAuthSession(session.sessionToken)).toBeUndefined();

    database.close();
  });
});
