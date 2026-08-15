import type Database from 'better-sqlite3';
import { identifier, money, type Timestamp } from '@jcb/domain';
import { transfer } from '@jcb/economy';
import { ulid } from 'ulid';
import { SqliteLedgerStore } from './ledger-store.js';

export interface AdminAuditInput {
  readonly actorUserId?: string | undefined;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly reason?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly ipHash?: string;
}

export class SqliteAdminCommandStore {
  private readonly ledger: SqliteLedgerStore;

  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
  ) {
    this.ledger = new SqliteLedgerStore(database, now);
  }

  public adjustBalance(input: {
    readonly targetAccountId: string;
    readonly signedAmount: bigint;
    readonly reason: string;
    readonly idempotencyKey: string;
    readonly actorUserId: string;
  }): string {
    if (input.signedAmount === 0n) throw new Error('Adjustment amount cannot be zero.');
    const bank = this.database
      .prepare(
        "SELECT id FROM accounts WHERE account_type = 'central_bank' AND owner_key = 'global'",
      )
      .get() as { id: string } | undefined;
    if (bank === undefined) throw new Error('Central bank account is missing.');
    const target = this.database
      .prepare('SELECT account_type AS accountType FROM accounts WHERE id = ?')
      .get(input.targetAccountId) as { accountType: string } | undefined;
    if (target === undefined) throw new Error('Target account is missing.');
    if (target.accountType !== 'user') {
      throw new Error('Only user accounts can receive administrative balance adjustments.');
    }
    const magnitude = money(input.signedAmount < 0n ? -input.signedAmount : input.signedAmount);
    const entries =
      input.signedAmount > 0n
        ? transfer(identifier(bank.id), identifier(input.targetAccountId), magnitude)
        : transfer(identifier(input.targetAccountId), identifier(bank.id), magnitude);
    const posted = this.ledger.post({
      kind: 'admin_adjustment',
      referenceType: 'account',
      referenceId: input.targetAccountId,
      idempotencyKey: input.idempotencyKey,
      description: input.reason,
      entries,
    });
    if (!posted.wasDuplicate) {
      this.recordAudit({
        actorUserId: input.actorUserId,
        action: 'ledger.adjusted',
        targetType: 'account',
        targetId: input.targetAccountId,
        reason: input.reason,
        after: { transactionId: posted.id, amount: input.signedAmount.toString() },
      });
    }
    return posted.id;
  }

  public retryJob(jobId: string, at: Timestamp): void {
    const result = this.database
      .prepare(
        `UPDATE scheduled_jobs SET status = 'pending', run_at = ?, locked_at = NULL,
         locked_by = NULL,
         attempt_count = CASE WHEN status = 'dead_letter' THEN 0 ELSE attempt_count END,
         last_error_code = NULL, last_error_redacted = NULL, updated_at = ?
         WHERE id = ? AND status IN ('retry_wait', 'dead_letter')`,
      )
      .run(BigInt(at), BigInt(at), jobId);
    if (result.changes !== 1)
      throw new Error('Only retry-wait or dead-letter jobs can be retried.');
  }

  public addAdministrator(input: {
    readonly discordUserId: string;
    readonly actorUserId: string;
    readonly reason: string;
  }): void {
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO admin_allowlist
         (discord_user_id, added_by_user_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(input.discordUserId, input.actorUserId, BigInt(this.now()));
    if (result.changes === 0) return;
    this.recordAudit({
      actorUserId: input.actorUserId,
      action: 'administrator.added',
      targetType: 'discord_user',
      targetId: input.discordUserId,
      reason: input.reason,
    });
  }

  public removeAdministrator(input: {
    readonly discordUserId: string;
    readonly actorUserId: string;
    readonly reason: string;
  }): void {
    const run = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `DELETE FROM admin_allowlist
           WHERE discord_user_id = ?
             AND (SELECT COUNT(*) FROM admin_allowlist) > 1`,
        )
        .run(input.discordUserId);
      if (result.changes !== 1) {
        const count = this.database
          .prepare('SELECT COUNT(*) AS count FROM admin_allowlist')
          .get() as { count: bigint };
        if (count.count <= 1n) throw new Error('The final administrator cannot be removed.');
        throw new Error('Administrator was not found.');
      }
      this.database
        .prepare(
          `UPDATE web_sessions SET revoked_at = ?
           WHERE discord_user_id = ? AND auth_method = 'discord_oauth'
             AND revoked_at IS NULL`,
        )
        .run(BigInt(this.now()), input.discordUserId);
      this.recordAudit({
        actorUserId: input.actorUserId,
        action: 'administrator.removed',
        targetType: 'discord_user',
        targetId: input.discordUserId,
        reason: input.reason,
      });
    });
    run.immediate();
  }

  public recordAudit(input: AdminAuditInput): void {
    this.database
      .prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, action, target_type, target_id, reason,
          before_json, after_json, ip_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ulid(),
        input.actorUserId ?? null,
        input.action,
        input.targetType,
        input.targetId,
        input.reason ?? null,
        input.before === undefined ? null : JSON.stringify(input.before),
        input.after === undefined ? null : JSON.stringify(input.after),
        input.ipHash ?? null,
        BigInt(this.now()),
      );
  }

  public ensureSetting(key: string, value: unknown): void {
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO app_settings
         (key, value_json, updated_by_user_id, updated_at)
         VALUES (?, ?, NULL, ?)`,
      )
      .run(key, JSON.stringify(value), BigInt(this.now()));
    if (result.changes === 0) {
      const current = this.getSetting(key);
      const merged = mergeMissingDefaults(current, value);
      if (JSON.stringify(merged) !== JSON.stringify(current)) {
        this.database
          .prepare(
            `UPDATE app_settings SET value_json = ?, updated_at = ?
             WHERE key = ?`,
          )
          .run(JSON.stringify(merged), BigInt(this.now()), key);
      }
    }
  }

  public recordSystemSetting(key: string, value: unknown): void {
    const valueJson = JSON.stringify(value);
    this.database
      .prepare(
        `INSERT INTO app_settings
         (key, value_json, updated_by_user_id, updated_at)
         VALUES (?, ?, NULL, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_by_user_id = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(key, valueJson, BigInt(this.now()));
  }

  public getSetting(key: string): unknown {
    const row = this.database
      .prepare('SELECT value_json AS valueJson FROM app_settings WHERE key = ?')
      .get(key) as { valueJson: string } | undefined;
    if (row === undefined) throw new Error(`Setting ${key} was not found.`);
    return JSON.parse(row.valueJson) as unknown;
  }

  public updateSetting(input: {
    readonly key: string;
    readonly value: unknown;
    readonly actorUserId: string;
    readonly reason: string;
  }): void {
    const run = this.database.transaction(() => {
      const before = this.getSetting(input.key);
      const valueJson = JSON.stringify(input.value);
      const result = this.database
        .prepare(
          `UPDATE app_settings
           SET value_json = ?, updated_by_user_id = ?, updated_at = ?
           WHERE key = ?`,
        )
        .run(valueJson, input.actorUserId, BigInt(this.now()), input.key);
      if (result.changes !== 1) throw new Error(`Setting ${input.key} was not found.`);
      this.recordAudit({
        actorUserId: input.actorUserId,
        action: 'setting.updated',
        targetType: 'app_setting',
        targetId: input.key,
        reason: input.reason,
        before,
        after: input.value,
      });
    });
    run.immediate();
  }
}

function mergeMissingDefaults(current: unknown, defaults: unknown): unknown {
  if (
    typeof current !== 'object' ||
    current === null ||
    Array.isArray(current) ||
    typeof defaults !== 'object' ||
    defaults === null ||
    Array.isArray(defaults)
  ) {
    return current;
  }
  const result: Record<string, unknown> = { ...(current as Record<string, unknown>) };
  for (const [key, defaultValue] of Object.entries(defaults)) {
    result[key] = key in result ? mergeMissingDefaults(result[key], defaultValue) : defaultValue;
  }
  return result;
}
