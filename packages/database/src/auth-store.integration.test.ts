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
    const issued = store.issueLoginTicket('123456');
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
    expect(() => store.validateSession(exchanged.sessionToken, 'wrong')).toThrow();
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
});
