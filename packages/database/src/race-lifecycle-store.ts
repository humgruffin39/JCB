import type Database from 'better-sqlite3';
import { decryptAesGcmWithKeys, deriveResultKey, type EncryptedPayload } from '@jcb/application';
import {
  identifier,
  money,
  transitionRace,
  type AccountId,
  type PoolType,
  type RaceStatus,
  type Timestamp,
} from '@jcb/domain';
import { transfer } from '@jcb/economy';
import { currentOddsTenths, formatOdds } from '@jcb/odds';
import { verifyOfficialSimulationResult, type OfficialSimulationResult } from '@jcb/simulation';
import { SqliteLedgerStore } from './ledger-store.js';
import { normalizeMasterSecrets } from './master-secret-keyring.js';
import { SqliteObjectPublicationStore } from './object-publication-store.js';
import { loadOpenTickets, loadRacePools, settleRacePool } from './race-pool-settlement.js';

interface RaceLifecycleRow {
  readonly id: string;
  readonly status: RaceStatus;
  readonly version: bigint;
  readonly scheduledAt: bigint;
  readonly bettingClosesAt: bigint;
  readonly timelineDurationMs: bigint | null;
}

const RACE_PROGRESS_ORDER: readonly RaceStatus[] = [
  'draft',
  'locked',
  'simulating',
  'betting_open',
  'betting_closed',
  'ready',
  'running',
  'finished',
  'settling',
  'settled',
];

export class SqliteRaceLifecycleStore {
  private readonly ledger: SqliteLedgerStore;

  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
    resultMasterSecret: string | readonly string[],
  ) {
    this.resultMasterSecrets = normalizeMasterSecrets(resultMasterSecret);
    this.ledger = new SqliteLedgerStore(database, now);
  }

  private readonly resultMasterSecrets: readonly string[];

  public closeBetting(raceId: string, at: Timestamp): void {
    const run = this.database.transaction(() => {
      const race = this.loadRace(raceId);
      if (isAtOrAfter(race.status, 'betting_closed')) return;
      transitionRace(race.status, 'betting_closed');
      if (at < Number(race.bettingClosesAt)) throw new Error('Betting close boundary not reached.');
      const odds = this.calculateFinalOdds(raceId);
      const update = this.database
        .prepare(
          `UPDATE races SET status = 'betting_closed', final_odds_json = ?, updated_at = ?
           WHERE id = ? AND status = 'betting_open'`,
        )
        .run(JSON.stringify(odds), BigInt(at), raceId);
      if (update.changes !== 1)
        throw new Error('Betting close transition lost a concurrent update.');
      this.database
        .prepare("UPDATE bet_pools SET status = 'closed', finalized_at = ? WHERE race_id = ?")
        .run(BigInt(at), raceId);
    });
    run.immediate();
  }

  public markReady(raceId: string): void {
    const race = this.loadRace(raceId);
    if (isAtOrAfter(race.status, 'ready')) return;
    transitionRace(race.status, 'ready');
    const result = this.database
      .prepare(
        `UPDATE races SET status = 'ready', updated_at = ?
         WHERE id = ? AND status = 'betting_closed'`,
      )
      .run(BigInt(this.now()), raceId);
    if (result.changes !== 1) throw new Error('Race ready transition lost a concurrent update.');
  }

  public markRunning(raceId: string, at: Timestamp): void {
    const race = this.loadRace(raceId);
    if (isAtOrAfter(race.status, 'running')) return;
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
      if (isAtOrAfter(race.status, 'finished'))
        return this.decryptOfficialResult(raceId, Number(race.version));
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
      const updateRace = this.database
        .prepare(
          `UPDATE races SET status = 'finished', updated_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(BigInt(at), raceId);
      if (updateRace.changes !== 1)
        throw new Error('Race finished transition lost a concurrent update.');
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
      const markSettling = this.database
        .prepare("UPDATE races SET status = 'settling', updated_at = ? WHERE id = ? AND status = ?")
        .run(BigInt(at), raceId, race.status);
      if (markSettling.changes !== 1) {
        throw new Error('Race settling transition lost a concurrent update.');
      }
      const finish = this.database
        .prepare(
          `SELECT horse_number AS horseNumber, finish_position AS finishPosition
           FROM race_entries
           WHERE race_id = ? AND finish_position IS NOT NULL
           ORDER BY finish_position`,
        )
        .all(raceId) as Array<{ horseNumber: bigint; finishPosition: bigint }>;
      if (
        finish.length !== 8 ||
        finish.some((entry, index) => Number(entry.finishPosition) !== index + 1)
      ) {
        throw new Error('Materialized finish order is incomplete.');
      }
      const winSelection = String(finish[0]!.horseNumber);
      const trifectaSelection = `${finish[0]!.horseNumber}-${finish[1]!.horseNumber}-${finish[2]!.horseNumber}`;
      const centralBankAccountId = this.findAccount('central_bank', 'global');
      const pools = loadRacePools(this.database, raceId);
      if (
        pools.length !== 2 ||
        !pools.some((pool) => pool.poolType === 'win') ||
        !pools.some((pool) => pool.poolType === 'trifecta')
      ) {
        throw new Error('Race pools are incomplete.');
      }
      for (const pool of pools) {
        settleRacePool({
          database: this.database,
          ledger: this.ledger,
          centralBankAccountId,
          raceId,
          raceVersion: Number(race.version),
          pool,
          winningSelection: pool.poolType === 'win' ? winSelection : trifectaSelection,
          at,
        });
      }
      const markSettled = this.database
        .prepare(
          `UPDATE races SET status = 'settled', updated_at = ?
           WHERE id = ? AND status = 'settling'`,
        )
        .run(BigInt(at), raceId);
      if (markSettled.changes !== 1) {
        throw new Error('Race settled transition lost a concurrent update.');
      }
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
      new SqliteObjectPublicationStore(this.database).cancelForRace(raceId, Number(at));
      this.database
        .prepare(
          `UPDATE scheduled_jobs
           SET status = 'completed', locked_at = NULL, locked_by = NULL, updated_at = ?
           WHERE status IN ('pending', 'retry_wait')
             AND job_type IN (
               'simulate_race', 'publish_race', 'refresh_race_message', 'open_viewer',
               'close_betting', 'mark_running', 'mark_finished', 'settle_race'
             )
             AND json_extract(payload_json, '$.raceId') = ?`,
        )
        .run(BigInt(at), raceId);
      const updateRefundedBet = this.database.prepare(
        `UPDATE bets SET status = 'refunded', payout = stake, settled_at = ?
         WHERE id = ? AND status = 'open'`,
      );
      const refundSeedPositions = this.database.prepare(
        'UPDATE seed_positions SET payout = stake WHERE pool_id = ?',
      );
      const finalizePool = this.database.prepare(
        "UPDATE bet_pools SET status = 'refunded', finalized_at = ? WHERE id = ?",
      );
      for (const pool of loadRacePools(this.database, raceId)) {
        const tickets = loadOpenTickets(this.database, pool.id);
        for (const ticket of tickets) {
          this.ledger.post({
            kind: 'bet_refund',
            referenceType: 'bet',
            referenceId: ticket.id,
            idempotencyKey: `refund:${ticket.id}`,
            description: `Race cancellation refund: ${reason}`,
            entries: transfer(identifier(pool.accountId), ticket.accountId, ticket.stake),
          });
          const result = updateRefundedBet.run(BigInt(at), ticket.id);
          if (result.changes !== 1) throw new Error('Open bet disappeared during refund.');
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
        refundSeedPositions.run(pool.id);
        finalizePool.run(BigInt(at), pool.id);
      }
      const cancelRace = this.database
        .prepare(
          `UPDATE races SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ?
           WHERE id = ? AND status = ?`,
        )
        .run(BigInt(at), reason, BigInt(at), raceId, race.status);
      if (cancelRace.changes !== 1) {
        throw new Error('Race cancellation transition lost a concurrent update.');
      }
    });
    run.immediate();
  }

  private decryptOfficialResult(raceId: string, raceVersion: number): OfficialSimulationResult {
    const row = this.database
      .prepare(
        `SELECT encrypted_result_blob AS encryptedResult, result_hash AS resultHash,
                simulation_version AS simulationVersion
         FROM race_simulations
         WHERE race_id = ? AND race_version = ? AND kind = 'official' AND status = 'completed'`,
      )
      .get(raceId, raceVersion) as
      | {
          encryptedResult: string;
          resultHash: string;
          simulationVersion: string;
        }
      | undefined;
    if (row === undefined) throw new Error('Completed official simulation is missing.');
    const payload = JSON.parse(row.encryptedResult) as EncryptedPayload;
    const keys = this.resultMasterSecrets.map((secret) =>
      deriveResultKey(secret, raceId, row.simulationVersion, raceVersion),
    );
    const decrypted = decryptAesGcmWithKeys(payload, keys);
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

  private findAccount(accountType: string, ownerKey: string): AccountId {
    const row = this.database
      .prepare('SELECT id FROM accounts WHERE account_type = ? AND owner_key = ?')
      .get(accountType, ownerKey) as { id: string } | undefined;
    if (row === undefined) throw new Error(`Account missing: ${accountType}:${ownerKey}`);
    return identifier(row.id);
  }
}

function isAtOrAfter(status: RaceStatus, target: RaceStatus): boolean {
  const statusIndex = RACE_PROGRESS_ORDER.indexOf(status);
  const targetIndex = RACE_PROGRESS_ORDER.indexOf(target);
  return statusIndex >= 0 && targetIndex >= 0 && statusIndex >= targetIndex;
}
