import type Database from 'better-sqlite3';
import { createOpaqueToken, hashOpaqueToken, matchesOpaqueTokenHash } from '@jcb/application';
import { timestamp, type Timestamp } from '@jcb/domain';
import { ulid } from 'ulid';

const TICKET_SESSION_LIFETIME_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
const ADMIN_SESSION_LIFETIME_MILLISECONDS = 10 * 365 * 24 * 60 * 60 * 1_000;

export interface IssuedLoginTicket {
  readonly ticket: string;
  readonly expiresAt: Timestamp;
}

export interface ExchangedSession {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly discordUserId: string;
  readonly raceId?: string;
  readonly expiresAt: Timestamp;
}

export type WebAuthenticationMethod = 'ticket' | 'discord_oauth';

export interface ValidSession {
  readonly id: string;
  readonly discordUserId: string;
  readonly raceId?: string;
  readonly expiresAt: Timestamp;
  readonly lastGuildCheckAt: Timestamp;
  readonly authenticationMethod: WebAuthenticationMethod;
  readonly reauthenticatedAt?: Timestamp;
}

export interface IssuedOAuthState {
  readonly state: string;
  readonly codeVerifier: string;
  readonly expiresAt: Timestamp;
}

export interface ConsumedOAuthState {
  readonly codeVerifier: string;
  readonly purpose: 'login' | 'emergency_reauthentication';
  readonly existingSessionId?: string;
}

interface TicketRow {
  readonly id: string;
  readonly discordUserId: string;
  readonly raceId: string | null;
  readonly expiresAt: bigint;
  readonly consumedAt: bigint | null;
}

interface SessionRow {
  readonly id: string;
  readonly discordUserId: string;
  readonly raceId: string | null;
  readonly expiresAt: bigint;
  readonly lastGuildCheckAt: bigint;
  readonly revokedAt: bigint | null;
  readonly csrfTokenHash: string;
  readonly authenticationMethod: WebAuthenticationMethod;
  readonly reauthenticatedAt: bigint | null;
}

interface OAuthStateRow {
  readonly id: string;
  readonly codeVerifier: string;
  readonly expiresAt: bigint;
  readonly consumedAt: bigint | null;
  readonly purpose: 'login' | 'emergency_reauthentication';
  readonly existingSessionId: string | null;
}

export class SqliteAuthStore {
  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
  ) {}

  public issueLoginTicket(discordUserId: string, raceId?: string): IssuedLoginTicket {
    const ticket = createOpaqueToken();
    const expiresAt = timestamp(this.now() + 5 * 60 * 1000);
    this.database
      .prepare(
        `INSERT INTO web_login_tickets
         (id, token_hash, discord_user_id, race_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ulid(),
        hashOpaqueToken(ticket),
        discordUserId,
        raceId ?? null,
        BigInt(expiresAt),
        BigInt(this.now()),
      );
    return { ticket, expiresAt };
  }

  public exchangeLoginTicket(ticket: string): ExchangedSession {
    const run = this.database.transaction((): ExchangedSession => {
      const row = this.database
        .prepare(
          `SELECT id, discord_user_id AS discordUserId, race_id AS raceId,
                  expires_at AS expiresAt, consumed_at AS consumedAt
           FROM web_login_tickets WHERE token_hash = ?`,
        )
        .get(hashOpaqueToken(ticket)) as TicketRow | undefined;
      if (row === undefined || row.consumedAt !== null || Number(row.expiresAt) <= this.now()) {
        throw new Error('Login ticket is invalid, consumed, or expired.');
      }
      const consume = this.database
        .prepare(
          `UPDATE web_login_tickets SET consumed_at = ?
           WHERE id = ? AND consumed_at IS NULL`,
        )
        .run(BigInt(this.now()), row.id);
      if (consume.changes !== 1) throw new Error('Login ticket was consumed concurrently.');
      return this.insertSession(
        row.discordUserId,
        'ticket',
        row.raceId ?? undefined,
        TICKET_SESSION_LIFETIME_MILLISECONDS,
      );
    });
    return run.immediate();
  }

  public issueOAuthState(
    purpose: 'login' | 'emergency_reauthentication' = 'login',
    existingSessionId?: string,
  ): IssuedOAuthState {
    if (purpose === 'emergency_reauthentication' && existingSessionId === undefined) {
      throw new Error('Emergency reauthentication requires an existing session.');
    }
    const state = createOpaqueToken();
    const codeVerifier = createOpaqueToken();
    const expiresAt = timestamp(this.now() + 10 * 60 * 1_000);
    this.database
      .prepare(
        `INSERT INTO oauth_login_states
         (id, state_hash, code_verifier, expires_at, created_at, purpose, existing_session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ulid(),
        hashOpaqueToken(state),
        codeVerifier,
        BigInt(expiresAt),
        BigInt(this.now()),
        purpose,
        existingSessionId ?? null,
      );
    return { state, codeVerifier, expiresAt };
  }

  public consumeOAuthState(state: string): ConsumedOAuthState {
    const consume = this.database.transaction(() => {
      const row = this.database
        .prepare(
          `SELECT id, code_verifier AS codeVerifier, expires_at AS expiresAt,
                  consumed_at AS consumedAt, purpose,
                  existing_session_id AS existingSessionId
           FROM oauth_login_states WHERE state_hash = ?`,
        )
        .get(hashOpaqueToken(state)) as OAuthStateRow | undefined;
      if (row === undefined || row.consumedAt !== null || Number(row.expiresAt) <= this.now()) {
        throw new Error('OAuth state is invalid, consumed, or expired.');
      }
      const update = this.database
        .prepare(
          `UPDATE oauth_login_states SET consumed_at = ?
           WHERE id = ? AND consumed_at IS NULL`,
        )
        .run(BigInt(this.now()), row.id);
      if (update.changes !== 1) throw new Error('OAuth state was consumed concurrently.');
      return {
        codeVerifier: row.codeVerifier,
        purpose: row.purpose,
        ...(row.existingSessionId === null ? {} : { existingSessionId: row.existingSessionId }),
      };
    });
    return consume.immediate();
  }

  public createOAuthSession(discordUserId: string): ExchangedSession {
    return this.insertSession(
      discordUserId,
      'discord_oauth',
      undefined,
      ADMIN_SESSION_LIFETIME_MILLISECONDS,
    );
  }

  public validateSession(sessionToken: string, csrfToken?: string): ValidSession {
    const row = this.database
      .prepare(
        `SELECT id, discord_user_id AS discordUserId, race_id AS raceId,
                expires_at AS expiresAt,
                last_guild_check_at AS lastGuildCheckAt, revoked_at AS revokedAt,
                csrf_token_hash AS csrfTokenHash, auth_method AS authenticationMethod,
                reauthenticated_at AS reauthenticatedAt
         FROM web_sessions WHERE token_hash = ?`,
      )
      .get(hashOpaqueToken(sessionToken)) as SessionRow | undefined;
    if (row === undefined || row.revokedAt !== null || Number(row.expiresAt) <= this.now()) {
      throw new Error('Web session is invalid or expired.');
    }
    if (csrfToken !== undefined && !matchesOpaqueTokenHash(csrfToken, row.csrfTokenHash)) {
      throw new Error('CSRF token is invalid.');
    }
    return {
      id: row.id,
      discordUserId: row.discordUserId,
      ...(row.raceId === null ? {} : { raceId: row.raceId }),
      expiresAt: timestamp(Number(row.expiresAt)),
      lastGuildCheckAt: timestamp(Number(row.lastGuildCheckAt)),
      authenticationMethod: row.authenticationMethod,
      ...(row.reauthenticatedAt === null
        ? {}
        : { reauthenticatedAt: timestamp(Number(row.reauthenticatedAt)) }),
    };
  }

  public rotateCsrfToken(sessionToken: string): string {
    const csrfToken = createOpaqueToken();
    const update = this.database
      .prepare(
        `UPDATE web_sessions SET csrf_token_hash = ?
         WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
      )
      .run(hashOpaqueToken(csrfToken), hashOpaqueToken(sessionToken), BigInt(this.now()));
    if (update.changes !== 1) throw new Error('Web session is invalid or expired.');
    return csrfToken;
  }

  public getOrRotateCsrfToken(sessionToken: string, currentToken?: string): string {
    if (currentToken !== undefined) {
      const row = this.database
        .prepare(
          `SELECT csrf_token_hash AS csrfTokenHash
           FROM web_sessions
           WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
        )
        .get(hashOpaqueToken(sessionToken), BigInt(this.now())) as
        { csrfTokenHash: string } | undefined;
      if (row !== undefined && matchesOpaqueTokenHash(currentToken, row.csrfTokenHash)) {
        return currentToken;
      }
    }
    return this.rotateCsrfToken(sessionToken);
  }

  public renewOAuthSession(sessionToken: string): Timestamp | undefined {
    const expiresAt = timestamp(this.now() + ADMIN_SESSION_LIFETIME_MILLISECONDS);
    const update = this.database
      .prepare(
        `UPDATE web_sessions
         SET expires_at = ?
         WHERE token_hash = ? AND auth_method = 'discord_oauth' AND revoked_at IS NULL
           AND expires_at > ?
           AND EXISTS (
             SELECT 1 FROM admin_allowlist
             WHERE admin_allowlist.discord_user_id = web_sessions.discord_user_id
           )`,
      )
      .run(BigInt(expiresAt), hashOpaqueToken(sessionToken), BigInt(this.now()));
    return update.changes === 1 ? expiresAt : undefined;
  }

  public markReauthenticated(
    sessionId: string,
    expectedDiscordUserId: string,
    at: Timestamp,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE web_sessions SET reauthenticated_at = ?
         WHERE id = ? AND discord_user_id = ? AND revoked_at IS NULL`,
      )
      .run(BigInt(at), sessionId, expectedDiscordUserId);
    if (result.changes !== 1) throw new Error('Existing session could not be reauthenticated.');
  }

  public markGuildChecked(sessionId: string, at: Timestamp): void {
    this.database
      .prepare('UPDATE web_sessions SET last_guild_check_at = ? WHERE id = ?')
      .run(BigInt(at), sessionId);
  }

  public revoke(sessionToken: string): void {
    this.database
      .prepare(
        `UPDATE web_sessions SET revoked_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL`,
      )
      .run(BigInt(this.now()), hashOpaqueToken(sessionToken));
  }

  public isAdmin(discordUserId: string): boolean {
    return (
      this.database
        .prepare('SELECT 1 FROM admin_allowlist WHERE discord_user_id = ?')
        .get(discordUserId) !== undefined
    );
  }

  private insertSession(
    discordUserId: string,
    authenticationMethod: WebAuthenticationMethod,
    raceId?: string,
    lifetimeMilliseconds = TICKET_SESSION_LIFETIME_MILLISECONDS,
  ): ExchangedSession {
    const sessionToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const expiresAt = timestamp(this.now() + lifetimeMilliseconds);
    this.database
      .prepare(
        `INSERT INTO web_sessions
         (id, token_hash, csrf_token_hash, discord_user_id, auth_method, race_id,
          expires_at, last_guild_check_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ulid(),
        hashOpaqueToken(sessionToken),
        hashOpaqueToken(csrfToken),
        discordUserId,
        authenticationMethod,
        raceId ?? null,
        BigInt(expiresAt),
        BigInt(this.now()),
        BigInt(this.now()),
      );
    return {
      sessionToken,
      csrfToken,
      discordUserId,
      ...(raceId === undefined ? {} : { raceId }),
      expiresAt,
    };
  }
}
