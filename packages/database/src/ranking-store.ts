import type Database from 'better-sqlite3';
import { ulid } from 'ulid';

export interface UserRanking {
  readonly userId: string;
  readonly displayName: string;
  readonly currentBalance: string;
  readonly lifetimeProfit: string;
  readonly totalPayout: string;
  readonly winHitRateBasisPoints: number;
  readonly trifectaWins: number;
  readonly maximumPayout: string;
  readonly currentLosingStreak: number;
  readonly longestLosingStreak: number;
}

export interface RankingSnapshot {
  readonly calculatedAt: number;
  readonly highestCarryover: string;
  readonly users: readonly UserRanking[];
}

interface UserSummaryRow {
  readonly userId: string;
  readonly displayName: string;
  readonly currentBalance: bigint;
  readonly totalStake: bigint;
  readonly totalPayout: bigint;
  readonly maximumPayout: bigint;
  readonly winTickets: bigint;
  readonly settledWinTickets: bigint;
  readonly trifectaWins: bigint;
}

interface BetOutcomeRow {
  readonly userId: string;
  readonly status: 'won' | 'lost';
}

export class SqliteRankingStore {
  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
  ) {}

  public calculateAndSave(): RankingSnapshot {
    const calculatedAt = this.now();
    const streaksByUser = this.streaksByUser();
    const users = this.userSummaries().map((row) => {
      const streaks = streaksByUser.get(row.userId) ?? { current: 0, longest: 0 };
      return {
        userId: row.userId,
        displayName: row.displayName,
        currentBalance: row.currentBalance.toString(),
        lifetimeProfit: (row.totalPayout - row.totalStake).toString(),
        totalPayout: row.totalPayout.toString(),
        winHitRateBasisPoints:
          row.settledWinTickets === 0n
            ? 0
            : Number((row.winTickets * 10_000n) / row.settledWinTickets),
        trifectaWins: Number(row.trifectaWins),
        maximumPayout: row.maximumPayout.toString(),
        currentLosingStreak: streaks.current,
        longestLosingStreak: streaks.longest,
      } satisfies UserRanking;
    });
    const snapshot: RankingSnapshot = {
      calculatedAt,
      highestCarryover: this.highestCarryover().toString(),
      users,
    };
    const source = this.database
      .prepare('SELECT id FROM ledger_transactions ORDER BY created_at DESC, id DESC LIMIT 1')
      .get() as { id: string } | undefined;
    this.database
      .prepare(
        `INSERT INTO ranking_snapshots
         (id, calculated_at, payload_json, source_ledger_transaction_id)
         VALUES (?, ?, ?, ?)`,
      )
      .run(ulid(), BigInt(calculatedAt), JSON.stringify(snapshot), source?.id ?? null);
    return snapshot;
  }

  private userSummaries(): readonly UserSummaryRow[] {
    return this.database
      .prepare(
        `SELECT u.id AS userId, u.display_name AS displayName,
                ab.amount AS currentBalance,
                COALESCE(SUM(CASE WHEN b.status IN ('won', 'lost') THEN b.stake ELSE 0 END), 0)
                  AS totalStake,
                COALESCE(SUM(CASE WHEN b.status = 'won' THEN b.payout ELSE 0 END), 0)
                  AS totalPayout,
                COALESCE(MAX(CASE WHEN b.status = 'won' THEN b.payout ELSE 0 END), 0)
                  AS maximumPayout,
                COALESCE(SUM(CASE WHEN bp.pool_type = 'win' AND b.status = 'won' THEN 1 ELSE 0 END), 0)
                  AS winTickets,
                COALESCE(SUM(CASE WHEN bp.pool_type = 'win' AND b.status IN ('won', 'lost') THEN 1 ELSE 0 END), 0)
                  AS settledWinTickets,
                COALESCE(SUM(CASE WHEN bp.pool_type = 'trifecta' AND b.status = 'won' THEN 1 ELSE 0 END), 0)
                  AS trifectaWins
         FROM users u
         JOIN accounts a ON a.account_type = 'user' AND a.owner_key = u.id
         JOIN account_balances ab ON ab.account_id = a.id
         LEFT JOIN bets b ON b.user_id = u.id
         LEFT JOIN bet_pools bp ON bp.id = b.pool_id
         GROUP BY u.id, u.display_name, ab.amount
         ORDER BY ab.amount DESC, u.created_at, u.id`,
      )
      .all() as UserSummaryRow[];
  }

  private streaksByUser(): ReadonlyMap<
    string,
    { readonly current: number; readonly longest: number }
  > {
    const outcomes = this.database
      .prepare(
        `SELECT user_id AS userId, status
         FROM bets
         WHERE status IN ('won', 'lost')
         ORDER BY user_id, COALESCE(settled_at, created_at), created_at, id`,
      )
      .all() as BetOutcomeRow[];
    const streaks = new Map<string, { current: number; longest: number }>();
    for (const outcome of outcomes) {
      const streak = streaks.get(outcome.userId) ?? { current: 0, longest: 0 };
      streak.current = outcome.status === 'lost' ? streak.current + 1 : 0;
      streak.longest = Math.max(streak.longest, streak.current);
      streaks.set(outcome.userId, streak);
    }
    return streaks;
  }

  private highestCarryover(): bigint {
    const account = this.database
      .prepare("SELECT account_id AS accountId FROM trifecta_carryover WHERE id = 'global'")
      .get() as { accountId: string } | undefined;
    if (account === undefined) return 0n;
    const entries = this.database
      .prepare(
        `SELECT amount FROM ledger_entries
         WHERE account_id = ? ORDER BY created_at, id`,
      )
      .all(account.accountId) as { amount: bigint }[];
    let balance = 0n;
    let highest = 0n;
    for (const entry of entries) {
      balance += entry.amount;
      highest = balance > highest ? balance : highest;
    }
    return highest;
  }
}
