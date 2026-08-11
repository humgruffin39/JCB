import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { SqliteLedgerStore } from './ledger-store.js';

export interface AdminHealth {
  readonly databaseReadWrite: boolean;
  readonly ledgerProjectionValid: boolean;
  readonly centralBankBalance: string;
  readonly allAccountBalanceTotal: string;
  readonly userBalanceTotal: string;
  readonly poolBalanceTotal: string;
  readonly carryoverBalance: string;
  readonly seedLiquidityProfitLoss: string;
  readonly reliefGrantedTotal: string;
  readonly medianUserPoolByRaceKind: Readonly<Record<string, string>>;
  readonly topTwentyPercentShareBasisPoints: number;
  readonly thirtyDayMovementTotal: string;
  readonly lastBackupSuccessAt: string | null;
  readonly lastRestoreDrillAt: string | null;
  readonly schedulerHeartbeatAt: string | null;
  readonly schedulerStatus: 'nominal' | 'failure';
  readonly r2LastAccessAt: string | null;
  readonly r2AccessStatus: 'nominal' | 'failure';
  readonly discordMessageCount: number;
  readonly timelineObjectCount: number;
  readonly pendingJobs: number;
  readonly deadJobs: number;
}

export class SqliteAdminHealthStore {
  private readonly ledger: SqliteLedgerStore;

  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
  ) {
    this.ledger = new SqliteLedgerStore(database, now);
  }

  public health(): AdminHealth {
    let ledgerProjectionValid = true;
    try {
      this.ledger.assertProjectionIntegrity();
    } catch {
      ledgerProjectionValid = false;
    }
    const bank = this.database
      .prepare(
        `SELECT ab.amount FROM account_balances ab
         JOIN accounts a ON a.id = ab.account_id
         WHERE a.account_type = 'central_bank' AND a.owner_key = 'global'`,
      )
      .get() as { amount: bigint } | undefined;
    const balanceTotals = this.database
      .prepare(
        `SELECT
           COALESCE(SUM(ab.amount), 0) AS allAccounts,
           COALESCE(SUM(CASE WHEN a.account_type = 'user' THEN ab.amount ELSE 0 END), 0) AS users,
           COALESCE(SUM(CASE WHEN a.account_type IN ('race_win_pool', 'race_trifecta_pool')
                            THEN ab.amount ELSE 0 END), 0) AS pools,
           COALESCE(SUM(CASE WHEN a.account_type = 'trifecta_carryover'
                            THEN ab.amount ELSE 0 END), 0) AS carryover
         FROM account_balances ab JOIN accounts a ON a.id = ab.account_id`,
      )
      .get() as { allAccounts: bigint; users: bigint; pools: bigint; carryover: bigint };
    const seedProfitLoss = this.database
      .prepare(
        `SELECT COALESCE(SUM(le.amount), 0) AS amount
         FROM ledger_entries le
         JOIN accounts a ON a.id = le.account_id
         JOIN ledger_transactions lt ON lt.id = le.transaction_id
         WHERE a.account_type = 'central_bank' AND a.owner_key = 'global'
           AND lt.kind IN ('seed_liquidity', 'seed_refund', 'pool_settlement')`,
      )
      .get() as { amount: bigint };
    const relief = this.database
      .prepare(
        `SELECT COALESCE(SUM(le.amount), 0) AS amount
         FROM ledger_entries le
         JOIN accounts a ON a.id = le.account_id
         JOIN ledger_transactions lt ON lt.id = le.transaction_id
         WHERE a.account_type = 'user' AND lt.kind = 'relief'`,
      )
      .get() as { amount: bigint };
    const movement = this.database
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE amount END), 0) / 2 AS amount
         FROM ledger_entries WHERE created_at >= ?`,
      )
      .get(BigInt(this.now() - 30 * 24 * 60 * 60 * 1_000)) as { amount: bigint };
    const settings = Object.fromEntries(
      (
        this.database
          .prepare(
            `SELECT key, value_json AS valueJson FROM app_settings
             WHERE key IN (
               'last_backup_success_at', 'last_restore_drill_at',
               'scheduler_heartbeat_at', 'last_r2_access_at'
             )`,
          )
          .all() as { key: string; valueJson: string }[]
      ).map((row) => [row.key, parseNullableString(row.valueJson)]),
    );
    const jobs = this.database
      .prepare(
        `SELECT
           SUM(CASE WHEN status IN ('pending', 'retry_wait', 'running') THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) AS dead
         FROM scheduled_jobs`,
      )
      .get() as { pending: bigint | null; dead: bigint | null };
    const operational = this.database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM discord_messages) AS discordMessages,
           (SELECT COUNT(*) FROM race_simulations
            WHERE kind = 'official' AND timeline_object_key IS NOT NULL) AS timelineObjects`,
      )
      .get() as { discordMessages: bigint; timelineObjects: bigint };
    const schedulerHeartbeatAt = settings.scheduler_heartbeat_at ?? null;
    const r2LastAccessAt = settings.last_r2_access_at ?? null;
    const isRecent = (value: string | null, maximumAge: number): boolean =>
      value !== null &&
      Number.isFinite(Date.parse(value)) &&
      this.now() - Date.parse(value) <= maximumAge;
    return {
      databaseReadWrite: this.probeDatabaseReadWrite(),
      ledgerProjectionValid,
      centralBankBalance: (bank?.amount ?? 0n).toString(),
      allAccountBalanceTotal: balanceTotals.allAccounts.toString(),
      userBalanceTotal: balanceTotals.users.toString(),
      poolBalanceTotal: balanceTotals.pools.toString(),
      carryoverBalance: balanceTotals.carryover.toString(),
      seedLiquidityProfitLoss: seedProfitLoss.amount.toString(),
      reliefGrantedTotal: relief.amount.toString(),
      medianUserPoolByRaceKind: this.medianUserPools(),
      topTwentyPercentShareBasisPoints: this.topTwentyPercentShare(),
      thirtyDayMovementTotal: movement.amount.toString(),
      lastBackupSuccessAt: settings.last_backup_success_at ?? null,
      lastRestoreDrillAt: settings.last_restore_drill_at ?? null,
      schedulerHeartbeatAt,
      schedulerStatus: isRecent(schedulerHeartbeatAt, 2 * 60 * 1_000) ? 'nominal' : 'failure',
      r2LastAccessAt,
      r2AccessStatus: isRecent(r2LastAccessAt, 65 * 60 * 1_000) ? 'nominal' : 'failure',
      discordMessageCount: Number(operational.discordMessages),
      timelineObjectCount: Number(operational.timelineObjects),
      pendingJobs: Number(jobs.pending ?? 0n),
      deadJobs: Number(jobs.dead ?? 0n),
    };
  }

  private probeDatabaseReadWrite(): boolean {
    const nonce = ulid();
    try {
      return this.database
        .transaction(() => {
          this.database
            .prepare(
              `INSERT INTO health_probes (id, nonce, updated_at)
               VALUES ('database', ?, ?)
               ON CONFLICT(id) DO UPDATE SET nonce = excluded.nonce,
                 updated_at = excluded.updated_at`,
            )
            .run(nonce, BigInt(this.now()));
          const row = this.database
            .prepare("SELECT nonce FROM health_probes WHERE id = 'database'")
            .get() as { nonce: string } | undefined;
          return row?.nonce === nonce;
        })
        .immediate();
    } catch {
      return false;
    }
  }

  private medianUserPools(): Readonly<Record<string, string>> {
    const rows = this.database
      .prepare(
        `SELECT r.kind, bp.user_stake_total AS amount
         FROM bet_pools bp JOIN races r ON r.id = bp.race_id
         ORDER BY r.kind, bp.user_stake_total`,
      )
      .all() as { kind: string; amount: bigint }[];
    const grouped = new Map<string, bigint[]>();
    for (const row of rows) {
      const values = grouped.get(row.kind) ?? [];
      values.push(row.amount);
      grouped.set(row.kind, values);
    }
    return Object.fromEntries(
      ['regular', 'midweek', 'saturday_night'].map((kind) => {
        const values = grouped.get(kind) ?? [];
        if (values.length === 0) return [kind, '0'];
        const middle = Math.floor(values.length / 2);
        const median =
          values.length % 2 === 1
            ? (values[middle] ?? 0n)
            : ((values[middle - 1] ?? 0n) + (values[middle] ?? 0n)) / 2n;
        return [kind, median.toString()];
      }),
    );
  }

  private topTwentyPercentShare(): number {
    const rows = this.database
      .prepare(
        `SELECT ab.amount
         FROM account_balances ab JOIN accounts a ON a.id = ab.account_id
         WHERE a.account_type = 'user' ORDER BY ab.amount DESC`,
      )
      .all() as { amount: bigint }[];
    const total = rows.reduce((sum, row) => sum + row.amount, 0n);
    if (rows.length === 0 || total <= 0n) return 0;
    const count = Math.max(1, Math.ceil(rows.length * 0.2));
    const top = rows.slice(0, count).reduce((sum, row) => sum + row.amount, 0n);
    return Number((top * 10_000n) / total);
  }
}

function parseNullableString(valueJson: string): string | null {
  const parsed: unknown = JSON.parse(valueJson);
  return typeof parsed === 'string' ? parsed : null;
}
