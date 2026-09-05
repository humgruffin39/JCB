import type { SqliteDatabase } from '@jcb/database';
import type Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';
import type { Logger } from '../logging/logger.js';
import { parseState, type BotState } from './stateSchema.js';

interface CountingStateRow {
  readonly guild_id: string;
  readonly channel_id: string;
  readonly current_count: string;
  readonly best_count: string;
  readonly failure_counts_json: string;
  readonly successful_counts_json: string;
  readonly applied_history_imports_json: string;
  readonly last_processed_message_id: string | null;
  readonly last_accepted_message_id: string | null;
  readonly last_counter_user_id: string | null;
  readonly pending_failures_json: string;
  readonly updated_at: string;
}

export class StateStore {
  private readonly readStatement: Database.Statement;
  private readonly writeStatement: Database.Statement;

  public constructor(
    private readonly database: SqliteDatabase,
    private readonly logger: Logger,
  ) {
    this.readStatement = database.prepare(
      `SELECT guild_id, channel_id, current_count, best_count,
              failure_counts_json, successful_counts_json,
              applied_history_imports_json, last_processed_message_id,
              last_accepted_message_id, last_counter_user_id,
              pending_failures_json, updated_at
       FROM counting_state WHERE id = 1`,
    );
    this.writeStatement = database.prepare(
      `INSERT INTO counting_state (
         id, guild_id, channel_id, current_count, best_count,
         failure_counts_json, successful_counts_json,
         applied_history_imports_json, last_processed_message_id,
         last_accepted_message_id, last_counter_user_id,
         pending_failures_json, updated_at
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         guild_id = excluded.guild_id,
         channel_id = excluded.channel_id,
         current_count = excluded.current_count,
         best_count = excluded.best_count,
         failure_counts_json = excluded.failure_counts_json,
         successful_counts_json = excluded.successful_counts_json,
         applied_history_imports_json = excluded.applied_history_imports_json,
         last_processed_message_id = excluded.last_processed_message_id,
         last_accepted_message_id = excluded.last_accepted_message_id,
         last_counter_user_id = excluded.last_counter_user_id,
         pending_failures_json = excluded.pending_failures_json,
         updated_at = excluded.updated_at`,
    );
  }

  public load(): BotState | null {
    const row = this.readStatement.get() as CountingStateRow | undefined;
    if (row === undefined) return null;
    return parseState({
      version: 1,
      guildId: row.guild_id,
      channelId: row.channel_id,
      currentCount: row.current_count,
      bestCount: row.best_count,
      failureCounts: JSON.parse(row.failure_counts_json) as unknown,
      successfulCounts: JSON.parse(row.successful_counts_json) as unknown,
      appliedHistoryImports: JSON.parse(row.applied_history_imports_json) as unknown,
      lastProcessedMessageId: row.last_processed_message_id,
      lastAcceptedMessageId: row.last_accepted_message_id,
      lastCounterUserId: row.last_counter_user_id,
      pendingFailures: JSON.parse(row.pending_failures_json) as unknown,
      updatedAt: row.updated_at,
    });
  }

  public async save(state: BotState): Promise<void> {
    this.saveWith(state, () => undefined);
  }

  /**
   * Persists the state together with the balance movement the same message
   * caused. Writing them separately can credit or debit a count and then lose
   * the state that says the count was processed, or the reverse.
   */
  public saveWith(state: BotState, work: () => void): void {
    const validated = parseState(state);
    const write = this.database.transaction(() => {
      work();
      this.writeStatement.run(
        validated.guildId,
        validated.channelId,
        validated.currentCount,
        validated.bestCount,
        JSON.stringify(validated.failureCounts),
        JSON.stringify(validated.successfulCounts),
        JSON.stringify(validated.appliedHistoryImports),
        validated.lastProcessedMessageId,
        validated.lastAcceptedMessageId,
        validated.lastCounterUserId,
        JSON.stringify(validated.pendingFailures),
        validated.updatedAt,
      );
    });
    write.immediate();
  }

  public async importJsonIfEmpty(
    path: string,
    expected?: Pick<BotState, 'guildId' | 'channelId'>,
  ): Promise<boolean> {
    if (this.load() !== null) return false;
    const raw = await readFile(path, 'utf8');
    const state = parseState(JSON.parse(raw) as unknown);
    if (
      expected !== undefined &&
      (state.guildId !== expected.guildId || state.channelId !== expected.channelId)
    ) {
      throw new Error(
        'Imported Counting state belongs to a different guild or channel; refusing to import it.',
      );
    }
    await this.save(state);
    this.logger.info('counting_state_imported', {
      path,
      guildId: state.guildId,
      channelId: state.channelId,
      currentCount: state.currentCount,
      bestCount: state.bestCount,
    });
    return true;
  }
}
