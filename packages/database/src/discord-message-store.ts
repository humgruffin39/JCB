import type Database from 'better-sqlite3';
import { ulid } from 'ulid';

export interface DiscordMessageReference {
  readonly purpose: string;
  readonly raceId?: string;
  readonly channelId: string;
  readonly messageId: string;
}

export class SqliteDiscordMessageStore {
  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
  ) {}

  public get(purpose: string, raceId?: string): DiscordMessageReference | undefined {
    const row = this.database
      .prepare(
        `SELECT purpose, race_id AS raceId, channel_id AS channelId, message_id AS messageId
         FROM discord_messages WHERE purpose = ?
           AND ((race_id IS NULL AND ? IS NULL) OR race_id = ?)`,
      )
      .get(purpose, raceId ?? null, raceId ?? null) as
      { purpose: string; raceId: string | null; channelId: string; messageId: string } | undefined;
    return row === undefined
      ? undefined
      : {
          purpose: row.purpose,
          ...(row.raceId === null ? {} : { raceId: row.raceId }),
          channelId: row.channelId,
          messageId: row.messageId,
        };
  }

  public save(reference: DiscordMessageReference): void {
    const existing = this.get(reference.purpose, reference.raceId);
    if (existing === undefined) {
      this.database
        .prepare(
          `INSERT INTO discord_messages
           (id, purpose, race_id, channel_id, message_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ulid(),
          reference.purpose,
          reference.raceId ?? null,
          reference.channelId,
          reference.messageId,
          BigInt(this.now()),
        );
      return;
    }
    this.database
      .prepare(
        `UPDATE discord_messages SET channel_id = ?, message_id = ?, updated_at = ?
         WHERE purpose = ? AND ((race_id IS NULL AND ? IS NULL) OR race_id = ?)`,
      )
      .run(
        reference.channelId,
        reference.messageId,
        BigInt(this.now()),
        reference.purpose,
        reference.raceId ?? null,
        reference.raceId ?? null,
      );
  }

  public remove(purpose: string, raceId?: string): void {
    this.database
      .prepare(
        `DELETE FROM discord_messages WHERE purpose = ?
         AND ((race_id IS NULL AND ? IS NULL) OR race_id = ?)`,
      )
      .run(purpose, raceId ?? null, raceId ?? null);
  }
}
