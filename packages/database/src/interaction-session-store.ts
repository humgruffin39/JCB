import type Database from 'better-sqlite3';
import type { PurchaseSession, PurchaseSessionStore } from '@jcb/discord';
import { timestamp } from '@jcb/domain';
import { ulid } from 'ulid';

interface SessionRow {
  readonly id: string;
  readonly discordUserId: string;
  readonly raceId: string;
  readonly raceVersion: bigint;
  readonly step: string;
  readonly payloadJson: string;
  readonly expiresAt: bigint;
}

export class SqliteInteractionSessionStore implements PurchaseSessionStore {
  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
  ) {}

  public create(input: Omit<PurchaseSession, 'id'>): PurchaseSession {
    const id = ulid();
    this.database
      .prepare(
        `INSERT INTO interaction_sessions
         (id, discord_user_id, race_id, race_version, step, payload_json,
          expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.discordUserId,
        input.raceId,
        input.raceVersion,
        input.step,
        JSON.stringify(input.payload),
        BigInt(input.expiresAt),
        BigInt(this.now()),
        BigInt(this.now()),
      );
    return { id, ...input };
  }

  public get(id: string): PurchaseSession | undefined {
    const row = this.database
      .prepare(
        `SELECT id, discord_user_id AS discordUserId, race_id AS raceId,
                race_version AS raceVersion, step, payload_json AS payloadJson,
                expires_at AS expiresAt FROM interaction_sessions WHERE id = ?`,
      )
      .get(id) as SessionRow | undefined;
    return row === undefined ? undefined : mapSession(row);
  }

  public update(
    id: string,
    expectedStep: string,
    step: string,
    payload: Readonly<Record<string, string>>,
  ): PurchaseSession {
    const result = this.database
      .prepare(
        `UPDATE interaction_sessions SET step = ?, payload_json = ?, updated_at = ?
         WHERE id = ? AND step = ? AND expires_at > ?`,
      )
      .run(step, JSON.stringify(payload), BigInt(this.now()), id, expectedStep, BigInt(this.now()));
    if (result.changes !== 1) {
      throw new Error('Purchase session is expired, missing, or was updated concurrently.');
    }
    const session = this.get(id);
    if (session === undefined) throw new Error('Purchase session disappeared.');
    return session;
  }
}

function mapSession(row: SessionRow): PurchaseSession {
  const payload = JSON.parse(row.payloadJson) as unknown;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Purchase session payload is invalid.');
  }
  const stringPayload: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== 'string') throw new Error('Purchase session value is invalid.');
    stringPayload[key] = value;
  }
  return {
    id: row.id,
    discordUserId: row.discordUserId,
    raceId: row.raceId,
    raceVersion: Number(row.raceVersion),
    step: row.step,
    payload: stringPayload,
    expiresAt: timestamp(Number(row.expiresAt)),
  };
}
