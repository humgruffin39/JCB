import type Database from 'better-sqlite3';
import { decryptAesGcm, deriveResultKey, type EncryptedPayload } from '@jcb/application';
import {
  identifier,
  money,
  transitionRace,
  type AccountId,
  type PoolType,
  type RaceStatus,
  type Timestamp,
} from '@jcb/domain';
import {
  settleTrifectaPool,
  settleWinPool,
  transfer,
  type OpenTicket,
  type SeedPosition,
  type SettlementResult,
} from '@jcb/economy';
import { currentOddsTenths, formatOdds } from '@jcb/odds';
import {
  SIMULATION_VERSION,
  verifyOfficialSimulationResult,
  type OfficialSimulationResult,
} from '@jcb/simulation';
import { SqliteLedgerStore } from './ledger-store.js';

interface RaceLifecycleRow {
  readonly id: string;
  readonly status: RaceStatus;
  readonly version: bigint;
  readonly scheduledAt: bigint;
  readonly bettingClosesAt: bigint;
  readonly timelineDurationMs: bigint | null;
}

interface PoolRow {
  readonly id: string;
  readonly poolType: PoolType;
  readonly accountId: string;
  readonly seedLiquidity: bigint;
  readonly userStakeTotal: bigint;
}

interface TicketRow {
  readonly id: string;
  readonly accountId: string;
  readonly selectionCode: string;
  readonly stake: bigint;
  readonly createdAt: bigint;
}

interface SeedRow {
  readonly selectionCode: string;
  readonly stake: bigint;
}

export class SqliteRaceLifecycleStore {
  private readonly ledger: SqliteLedgerStore;

  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
    private readonly resultMasterSecret: string,
  ) {
    this.ledger = new SqliteLedgerStore(database, now);
  }

  public closeBetting(raceId: string, at: Timestamp): void {
    const run = this.database.transaction(() => {
      const race = this.loadRace(raceId);
      transitionRace(race.status, 'betting_closed');
      if (at < Number(race.bettingClosesAt)) throw new Error('Betting close boundary not reached.');
      const odds = this.calculateFinalOdds(raceId);
      this.database
        .prepare(
          `UPDATE races SET status = 'betting_closed', final_odds_json = ?, updated_at = ?
           WHERE id = ? AND status = 'betting_open'`,
        )
        .run(JSON.stringify(odds), BigInt(at), raceId);
      this.database
        .prepare("UPDATE bet_pools SET status = 'closed', finalized_at = ? WHERE race_id = ?")
        .run(BigInt(at), raceId);
    });
    run.immediate();
  }

  public markReady(raceId: string): void {
    const race = this.loadRace(raceId);
    transitionRace(race.status, 'ready');
    this.database
      .prepare(
        `UPDATE races SET status = 'ready', updated_at = ?
         WHERE id = ? AND status = 'betting_closed'`,
      )
      .run(BigInt(this.now()), raceId);
  }

  public markRunning(raceId: string, at: Timestamp): void {
    const race = this.loadRace(raceId);
    transitionRace(race.status, 'running');
    if (at < Number(race.scheduledAt)) throw new Error('Scheduled start boundary not reached.');
    const result = this.database
      .prepare(
        `UPDATE races SET status = 'running', updated_at = ?
         WHERE id = ? AND status = 'ready'`,
      )
      .run(BigInt(at), raceId);
    if (result.changes !== 1) throw new Error('Race running transition lost a concurrent update.');
  }

  public markFinished(raceId: string, at: Timestamp): OfficialSimulationResult {
    const run = this.database.transaction(() => {
      const race = this.loadRace(raceId);
      transitionRace(race.status, 'finished');
      if (race.timelineDurationMs === null) throw new Error('Timeline duration is missing.');
      if (at < Number(race.scheduledAt + race.timelineDurationMs)) {
        throw new Error('Timeline has not finished.');
      }
      const official = this.decryptOfficialResult(raceId, Number(race.version));
      const updateEntry = this.database.prepare(
        `UPDATE race_entries SET finish_position = ?, finish_time_ms = ?
         WHERE race_id = ? AND horse_number = ?`,
      );
      for (const finish of official.finishOrder) {
        const result = updateEntry.run(
          finish.position,
          finish.finishTimeMs,
          raceId,
          finish.horseNumber,
        );
        if (result.changes !== 1) throw new Error('Official finish entry is missing.');
      }
      this.database
        .prepare(
          `UPDATE races SET status = 'finished', updated_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(BigInt(at), raceId);
      return official;
    });
    return run.immediate();
  }

  public settleRace(raceId: string, at: Timestamp): void {
    const run = this.database.transaction(() => {
      const race = this.loadRace(raceId);
      if (race.status === 'settled') return;
      transitionRace(race.status, 'settling');
      if (race.timelineDurationMs === null) throw new Error('Timeline duration is missing.');
      if (at < Number(race.scheduledAt + race.timelineDurationMs + 3_000n)) {
        throw new Error('Settlement publication delay not reached.');
      }
      this.database
        .prepare("UPDATE races SET status = 'settling', updated_at = ? WHERE id = ?")
        .run(BigInt(at), raceId);
      const finish = this.database
        .prepare(
          `SELECT horse_number AS horseNumber FROM race_entries
           WHERE race_id = ? ORDER BY finish_position`,
        )
        .all(raceId) as Array<{ horseNumber: bigint }>;
      if (finish.length !== 8) throw new Error('Materialized finish order is incomplete.');
      const winSelection = String(finish[0]!.horseNumber);
      const trifectaSelection = `${finish[0]!.horseNumber}-${finish[1]!.horseNumber}-${finish[2]!.horseNumber}`;
      for (const pool of this.loadPools(raceId)) {
        this.settlePool(
          raceId,
          Number(race.version),
          pool,
          pool.poolType === 'win' ? winSelection : trifectaSelection,
          at,
        );
      }
      this.database
        .prepare(
          `UPDATE races SET status = 'settled', updated_at = ?
           WHERE id = ? AND status = 'settling'`,
        )
        .run(BigInt(at), raceId);
      this.ledger.assertProjectionIntegrity();
    });
    run.immediate();
  }

  public emergencyReveal(raceId: string): OfficialSimulationResult {
    const race = this.loadRace(raceId);
    return this.decryptOfficialResult(raceId, Number(race.version));
  }

  public cancelAndRefund(raceId: string, reason: string, at: Timestamp): void {
    if (reason.trim().length < 3) throw new Error('Cancellation reason is required.');
    const run = this.database.transaction(() => {
      const race = this.loadRace(raceId);
      if (race.status === 'cancelled') return;
      transitionRace(race.status, 'cancelled');
      const centralBank = this.findAccount('central_bank', 'global');
      for (const pool of this.loadPools(raceId)) {
        const tickets = this.loadTickets(pool.id);
        for (const ticket of tickets) {
          this.ledger.post({
            kind: 'bet_refund',
            referenceType: 'bet',
            referenceId: ticket.id,
            idempotencyKey: `refund:${ticket.id}`,
            description: `Race cancellation refund: ${reason}`,
            entries: transfer(identifier(pool.accountId), ticket.accountId, ticket.stake),
          });
          this.database
            .prepare(
              `UPDATE bets SET status = 'refunded', payout = stake, settled_at = ?
               WHERE id = ? AND status = 'open'`,
            )
            .run(BigInt(at), ticket.id);
        }
        const remaining = this.ledger.balance(identifier(pool.accountId));
        if (remaining > 0n) {
          this.ledger.post({
            kind: 'seed_refund',
            referenceType: 'pool',
            referenceId: pool.id,
            idempotencyKey: `seed-refund:${pool.id}`,
            description: `Return seed liquidity after cancellation: ${reason}`,
            entries: transfer(identifier(pool.accountId), centralBank, remaining),
          });
        }
        this.database
          .prepare("UPDATE bet_pools SET status = 'refunded', finalized_at = ? WHERE id = ?")
          .run(BigInt(at), pool.id);
      }
      this.database
        .prepare(
          `UPDATE races SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(BigInt(at), reason, BigInt(at), raceId);
    });
    run.immediate();
  }

  private settlePool(
    raceId: string,
    raceVersion: number,
    pool: PoolRow,
    winningSelection: string,
    at: Timestamp,
  ): void {
    const tickets = this.loadTickets(pool.id);
    const seeds = this.loadSeedPositions(pool.id);
    const poolAccountId = identifier<'AccountId'>(pool.accountId);
    const centralBankAccountId = this.findAccount('central_bank', 'global');
    const common = {
      poolAccountId,
      centralBankAccountId,
      winningSelection,
      poolBalance: this.ledger.balance(poolAccountId),
      tickets,
      seedPositions: seeds,
    };
    let settlement: SettlementResult;
    if (pool.poolType === 'win') {
      settlement = settleWinPool(common);
    } else {
      const carryoverAccountId = this.findAccount('trifecta_carryover', 'global');
      settlement = settleTrifectaPool({
        ...common,
        carryoverAccountId,
        carryoverBalance: this.ledger.balance(carryoverAccountId),
      });
    }
    this.ledger.post({
      kind: 'pool_settlement',
      referenceType: 'pool',
      referenceId: pool.id,
      idempotencyKey: `settlement:${raceId}:${pool.poolType}:${String(raceVersion)}`,
      description: `${pool.poolType} pool settlement`,
      entries: settlement.ledgerEntries,
    });
    const payoutByTicket = new Map<string, bigint>();
    for (const payout of settlement.payouts) {
      if (payout.recipientType === 'user') {
        payoutByTicket.set(
          payout.recipientId,
          (payoutByTicket.get(payout.recipientId) ?? 0n) + payout.amount,
        );
      } else {
        this.database
          .prepare(`UPDATE seed_positions SET payout = ? WHERE pool_id = ? AND selection_code = ?`)
          .run(payout.amount, pool.id, payout.recipientId);
      }
    }
    for (const ticket of tickets) {
      const payout = payoutByTicket.get(ticket.id) ?? 0n;
      this.database
        .prepare(
          `UPDATE bets SET status = ?, payout = ?, settled_at = ?
           WHERE id = ? AND status = 'open'`,
        )
        .run(payout > 0n ? 'won' : 'lost', payout, BigInt(at), ticket.id);
    }
    this.database
      .prepare("UPDATE bet_pools SET status = 'settled', finalized_at = ? WHERE id = ?")
      .run(BigInt(at), pool.id);
    if (pool.poolType === 'trifecta') {
      const carryover = this.findAccount('trifecta_carryover', 'global');
      this.database
        .prepare(
          `UPDATE trifecta_carryover SET amount_projection = ?, updated_at = ?
           WHERE id = 'global'`,
        )
        .run(this.ledger.balance(carryover), BigInt(at));
    }
  }

  private decryptOfficialResult(raceId: string, raceVersion: number): OfficialSimulationResult {
    const row = this.database
      .prepare(
        `SELECT encrypted_result_blob AS encryptedResult, result_hash AS resultHash
         FROM race_simulations
         WHERE race_id = ? AND race_version = ? AND kind = 'official' AND status = 'completed'`,
      )
      .get(raceId, raceVersion) as { encryptedResult: string; resultHash: string } | undefined;
    if (row === undefined) throw new Error('Completed official simulation is missing.');
    const key = deriveResultKey(this.resultMasterSecret, raceId, SIMULATION_VERSION, raceVersion);
    const decrypted = decryptAesGcm(JSON.parse(row.encryptedResult) as EncryptedPayload, key);
    const parsed = JSON.parse(Buffer.from(decrypted).toString('utf8')) as OfficialSimulationResult;
    if (parsed.resultHash !== row.resultHash || !verifyOfficialSimulationResult(parsed)) {
      throw new Error('Official result integrity verification failed.');
    }
    return parsed;
  }

  private calculateFinalOdds(raceId: string): Readonly<Record<string, string>> {
    const rows = this.database
      .prepare(
        `SELECT op.pool_type AS poolType, op.selection_code AS selectionCode,
                bp.seed_liquidity AS seedLiquidity, bp.user_stake_total AS totalUserStake,
                op.seed_stake AS seedSelectionStake,
                COALESCE(SUM(b.stake), 0) AS userSelectionStake
         FROM odds_probabilities op
         JOIN bet_pools bp ON bp.race_id = op.race_id AND bp.pool_type = op.pool_type
         LEFT JOIN bets b ON b.pool_id = bp.id AND b.selection_code = op.selection_code
              AND b.status = 'open'
         WHERE op.race_id = ?
         GROUP BY op.pool_type, op.selection_code`,
      )
      .all(raceId) as Array<{
      poolType: PoolType;
      selectionCode: string;
      seedLiquidity: bigint;
      totalUserStake: bigint;
      seedSelectionStake: bigint;
      userSelectionStake: bigint;
    }>;
    return Object.fromEntries(
      rows.map((row) => [
        `${row.poolType}:${row.selectionCode}`,
        formatOdds(
          currentOddsTenths(
            money(row.seedLiquidity),
            money(row.totalUserStake),
            money(row.seedSelectionStake),
            money(row.userSelectionStake),
          ),
        ),
      ]),
    );
  }

  private loadRace(raceId: string): RaceLifecycleRow {
    const row = this.database
      .prepare(
        `SELECT id, status, version, scheduled_at AS scheduledAt,
                betting_closes_at AS bettingClosesAt,
                timeline_duration_ms AS timelineDurationMs
         FROM races WHERE id = ?`,
      )
      .get(raceId) as RaceLifecycleRow | undefined;
    if (row === undefined) throw new Error('Race not found.');
    return row;
  }

  private loadPools(raceId: string): readonly PoolRow[] {
    return this.database
      .prepare(
        `SELECT id, pool_type AS poolType, account_id AS accountId,
                seed_liquidity AS seedLiquidity, user_stake_total AS userStakeTotal
         FROM bet_pools WHERE race_id = ? ORDER BY pool_type`,
      )
      .all(raceId) as PoolRow[];
  }

  private loadTickets(poolId: string): readonly OpenTicket[] {
    return (
      this.database
        .prepare(
          `SELECT b.id, a.id AS accountId, b.selection_code AS selectionCode,
                  b.stake, b.created_at AS createdAt
           FROM bets b JOIN accounts a ON a.owner_key = b.user_id AND a.account_type = 'user'
           WHERE b.pool_id = ? AND b.status = 'open'
           ORDER BY b.created_at, b.id`,
        )
        .all(poolId) as TicketRow[]
    ).map((row) => ({
      id: row.id,
      accountId: identifier(row.accountId),
      selectionCode: row.selectionCode,
      stake: money(row.stake),
      createdAt: Number(row.createdAt),
    }));
  }

  private loadSeedPositions(poolId: string): readonly SeedPosition[] {
    return (
      this.database
        .prepare(
          `SELECT selection_code AS selectionCode, stake
           FROM seed_positions WHERE pool_id = ? ORDER BY selection_code`,
        )
        .all(poolId) as SeedRow[]
    ).map((row) => ({ selectionCode: row.selectionCode, stake: money(row.stake) }));
  }

  private findAccount(accountType: string, ownerKey: string): AccountId {
    const row = this.database
      .prepare('SELECT id FROM accounts WHERE account_type = ? AND owner_key = ?')
      .get(accountType, ownerKey) as { id: string } | undefined;
    if (row === undefined) throw new Error(`Account missing: ${accountType}:${ownerKey}`);
    return identifier(row.id);
  }
}
