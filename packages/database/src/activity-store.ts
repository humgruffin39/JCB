import type Database from 'better-sqlite3';
import { createOpaqueToken, hashOpaqueToken, matchesOpaqueTokenHash } from '@jcb/application';
import { timestamp, type Timestamp } from '@jcb/domain';
import { ulid } from 'ulid';

const LAUNCH_INTENT_LIFETIME_MILLISECONDS = 5 * 60 * 1_000;
const ACTIVITY_SESSION_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1_000;

export interface ActivityInstanceIdentity {
  readonly instanceId: string;
  readonly applicationId: string;
  readonly launchId: string;
  readonly guildId: string;
  readonly channelId: string;
}

export interface IssuedActivitySession {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly discordUserId: string;
  readonly instanceId: string;
  readonly raceId: string;
  readonly expiresAt: Timestamp;
}

export interface ValidActivitySession {
  readonly id: string;
  readonly discordUserId: string;
  readonly instanceId: string;
  readonly raceId: string;
  readonly expiresAt: Timestamp;
  readonly lastGuildCheckAt: Timestamp;
}

interface LaunchIntentRow {
  readonly id: string;
  readonly raceId: string;
}

interface InstanceRow {
  readonly applicationId: string;
  readonly launchId: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly raceId: string;
}

interface ActivitySessionRow {
  readonly id: string;
  readonly discordUserId: string;
  readonly instanceId: string;
  readonly raceId: string;
  readonly expiresAt: bigint;
  readonly lastGuildCheckAt: bigint;
  readonly revokedAt: bigint | null;
  readonly csrfTokenHash: string;
}

export class SqliteActivityStore {
  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
  ) {}

  public issueLaunchIntent(input: {
    readonly discordUserId: string;
    readonly guildId: string;
    readonly channelId: string;
    readonly raceId: string;
    readonly interactionId: string;
  }): Timestamp {
    const now = this.now();
    const expiresAt = timestamp(now + LAUNCH_INTENT_LIFETIME_MILLISECONDS);
    const issue = this.database.transaction(() => {
      // A user can only have one pending race launch at a given Discord location.
      // This removes ambiguity if the button is clicked twice in quick succession.
      this.database
        .prepare(
          `UPDATE activity_launch_intents SET superseded_at = ?
           WHERE discord_user_id = ? AND guild_id = ? AND channel_id = ?
             AND claimed_at IS NULL AND superseded_at IS NULL`,
        )
        .run(BigInt(now), input.discordUserId, input.guildId, input.channelId);
      this.database
        .prepare(
          `INSERT INTO activity_launch_intents
           (id, discord_user_id, guild_id, channel_id, race_id, interaction_id,
            expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ulid(),
          input.discordUserId,
          input.guildId,
          input.channelId,
          input.raceId,
          input.interactionId,
          BigInt(expiresAt),
          BigInt(now),
        );
    });
    issue.immediate();
    return expiresAt;
  }

  public cancelLaunchIntent(interactionId: string): void {
    this.database
      .prepare(
        `UPDATE activity_launch_intents SET superseded_at = ?
         WHERE interaction_id = ? AND claimed_at IS NULL AND superseded_at IS NULL`,
      )
      .run(BigInt(this.now()), interactionId);
  }

  /**
   * Atomically binds the first verified participant to a pending launch intent.
   * Once bound, other verified participants in that same Discord instance resolve
   * the existing race without needing their own intent.
   */
  public claimIntentOrResolveInstance(
    discordUserId: string,
    identity: ActivityInstanceIdentity,
  ): string {
    const claim = this.database.transaction((): string => {
      const existing = this.database
        .prepare(
          `SELECT application_id AS applicationId, launch_id AS launchId,
                  guild_id AS guildId, channel_id AS channelId, race_id AS raceId
           FROM activity_instances WHERE instance_id = ?`,
        )
        .get(identity.instanceId) as InstanceRow | undefined;
      if (existing !== undefined) {
        if (
          existing.applicationId !== identity.applicationId ||
          existing.launchId !== identity.launchId ||
          existing.guildId !== identity.guildId ||
          existing.channelId !== identity.channelId
        ) {
          throw new Error('Activity instance identity does not match its existing binding.');
        }
        this.database
          .prepare('UPDATE activity_instances SET last_verified_at = ? WHERE instance_id = ?')
          .run(BigInt(this.now()), identity.instanceId);
        return existing.raceId;
      }

      const intent = this.database
        .prepare(
          `SELECT id, race_id AS raceId
           FROM activity_launch_intents
           WHERE discord_user_id = ? AND guild_id = ? AND channel_id = ?
             AND claimed_at IS NULL AND superseded_at IS NULL AND expires_at > ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(discordUserId, identity.guildId, identity.channelId, BigInt(this.now())) as
        LaunchIntentRow | undefined;
      if (intent === undefined) {
        throw new Error('No pending Activity launch exists for this user and location.');
      }
      const consumed = this.database
        .prepare(
          `UPDATE activity_launch_intents
           SET claimed_at = ?, claimed_instance_id = ?
           WHERE id = ? AND claimed_at IS NULL AND superseded_at IS NULL AND expires_at > ?`,
        )
        .run(BigInt(this.now()), identity.instanceId, intent.id, BigInt(this.now()));
      if (consumed.changes !== 1) {
        throw new Error('Activity launch intent was claimed concurrently.');
      }
      this.database
        .prepare(
          `INSERT INTO activity_instances
           (instance_id, application_id, launch_id, guild_id, channel_id, race_id,
            bound_by_discord_user_id, created_at, last_verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          identity.instanceId,
          identity.applicationId,
          identity.launchId,
          identity.guildId,
          identity.channelId,
          intent.raceId,
          discordUserId,
          BigInt(this.now()),
          BigInt(this.now()),
        );
      return intent.raceId;
    });
    return claim.immediate();
  }

  public createSession(input: {
    readonly discordUserId: string;
    readonly instanceId: string;
    readonly raceId: string;
  }): IssuedActivitySession {
    const sessionToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const now = this.now();
    const expiresAt = timestamp(now + ACTIVITY_SESSION_LIFETIME_MILLISECONDS);
    const insert = this.database.transaction(() => {
      const binding = this.database
        .prepare('SELECT race_id AS raceId FROM activity_instances WHERE instance_id = ?')
        .get(input.instanceId) as { readonly raceId: string } | undefined;
      if (binding === undefined || binding.raceId !== input.raceId) {
        throw new Error('Activity session does not match its verified instance binding.');
      }
      this.database
        .prepare(
          `UPDATE activity_sessions SET revoked_at = ?
           WHERE discord_user_id = ? AND instance_id = ? AND revoked_at IS NULL`,
        )
        .run(BigInt(now), input.discordUserId, input.instanceId);
      this.database
        .prepare(
          `INSERT INTO activity_sessions
           (id, token_hash, csrf_token_hash, discord_user_id, instance_id, race_id,
            expires_at, last_guild_check_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ulid(),
          hashOpaqueToken(sessionToken),
          hashOpaqueToken(csrfToken),
          input.discordUserId,
          input.instanceId,
          input.raceId,
          BigInt(expiresAt),
          BigInt(now),
          BigInt(now),
        );
    });
    insert.immediate();
    return {
      sessionToken,
      csrfToken,
      discordUserId: input.discordUserId,
      instanceId: input.instanceId,
      raceId: input.raceId,
      expiresAt,
    };
  }

  public validateSession(sessionToken: string, csrfToken?: string): ValidActivitySession {
    const row = this.database
      .prepare(
        `SELECT id, discord_user_id AS discordUserId, instance_id AS instanceId,
                race_id AS raceId, expires_at AS expiresAt,
                last_guild_check_at AS lastGuildCheckAt, revoked_at AS revokedAt,
                csrf_token_hash AS csrfTokenHash
         FROM activity_sessions WHERE token_hash = ?`,
      )
      .get(hashOpaqueToken(sessionToken)) as ActivitySessionRow | undefined;
    if (row === undefined || row.revokedAt !== null || Number(row.expiresAt) <= this.now()) {
      throw new Error('Activity session is invalid or expired.');
    }
    if (csrfToken !== undefined && !matchesOpaqueTokenHash(csrfToken, row.csrfTokenHash)) {
      throw new Error('CSRF token is invalid.');
    }
    return {
      id: row.id,
      discordUserId: row.discordUserId,
      instanceId: row.instanceId,
      raceId: row.raceId,
      expiresAt: timestamp(Number(row.expiresAt)),
      lastGuildCheckAt: timestamp(Number(row.lastGuildCheckAt)),
    };
  }

  public markGuildChecked(sessionId: string, at: Timestamp): void {
    this.database
      .prepare('UPDATE activity_sessions SET last_guild_check_at = ? WHERE id = ?')
      .run(BigInt(at), sessionId);
  }

  public getOrRotateCsrfToken(sessionToken: string, currentToken?: string): string {
    if (currentToken !== undefined) {
      const row = this.database
        .prepare(
          `SELECT csrf_token_hash AS csrfTokenHash
           FROM activity_sessions
           WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
        )
        .get(hashOpaqueToken(sessionToken), BigInt(this.now())) as
        { readonly csrfTokenHash: string } | undefined;
      if (row !== undefined && matchesOpaqueTokenHash(currentToken, row.csrfTokenHash)) {
        return currentToken;
      }
    }
    const csrfToken = createOpaqueToken();
    const update = this.database
      .prepare(
        `UPDATE activity_sessions SET csrf_token_hash = ?
         WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
      )
      .run(hashOpaqueToken(csrfToken), hashOpaqueToken(sessionToken), BigInt(this.now()));
    if (update.changes !== 1) throw new Error('Activity session is invalid or expired.');
    return csrfToken;
  }

  public revoke(sessionToken: string): void {
    this.database
      .prepare(
        `UPDATE activity_sessions SET revoked_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL`,
      )
      .run(BigInt(this.now()), hashOpaqueToken(sessionToken));
  }
}
