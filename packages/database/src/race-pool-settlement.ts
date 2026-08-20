import type Database from 'better-sqlite3';
import { identifier, money, type AccountId, type PoolType, type Timestamp } from '@jcb/domain';
import {
  settleParimutuelPool,
  settleTrifectaPool,
  type OpenTicket,
  type SeedPosition,
  type SettlementResult,
} from '@jcb/economy';
import type { SqliteLedgerStore } from './ledger-store.js';

export interface RacePoolRow {
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

export function loadRacePools(database: Database.Database, raceId: string): readonly RacePoolRow[] {
  return database
    .prepare(
      `SELECT id, pool_type AS poolType, account_id AS accountId,
              seed_liquidity AS seedLiquidity, user_stake_total AS userStakeTotal
       FROM bet_pools WHERE race_id = ? ORDER BY pool_type`,
    )
    .all(raceId) as RacePoolRow[];
}

export function loadOpenTickets(
  database: Database.Database,
  poolId: string,
): readonly OpenTicket[] {
  return (
    database
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

export function settleRacePool(input: {
  readonly database: Database.Database;
  readonly ledger: SqliteLedgerStore;
  readonly centralBankAccountId: AccountId;
  readonly raceId: string;
  readonly raceVersion: number;
  readonly pool: RacePoolRow;
  readonly winningSelections?: readonly string[];
  readonly winningSelection?: string;
  readonly at: Timestamp;
}): void {
  const { database, ledger, pool } = input;
  const tickets = loadOpenTickets(database, pool.id);
  const seeds = loadSeedPositions(database, pool.id);
  const poolAccountId = identifier<'AccountId'>(pool.accountId);
  const seedTotal = seeds.reduce((sum, seed) => sum + seed.stake, 0n);
  const userTotal = tickets.reduce((sum, ticket) => sum + ticket.stake, 0n);
  const poolBalance = ledger.balance(poolAccountId);
  if (
    seedTotal !== pool.seedLiquidity ||
    userTotal !== pool.userStakeTotal ||
    poolBalance !== seedTotal + userTotal
  ) {
    throw new Error('Pool projection does not match its ledger balance.');
  }

  const winningSelections =
    input.winningSelections ??
    (input.winningSelection === undefined ? [] : [input.winningSelection]);
  if (winningSelections.length === 0) throw new Error('Winning selections are missing.');
  const common = {
    poolAccountId,
    centralBankAccountId: input.centralBankAccountId,
    poolBalance,
    tickets,
    seedPositions: seeds,
  };
  let settlement: SettlementResult;
  let carryoverAccountId: AccountId | undefined;
  if (pool.poolType === 'trifecta') {
    if (winningSelections.length !== 1) {
      throw new Error('Trifecta must have exactly one winning selection.');
    }
    carryoverAccountId = findAccount(database, 'trifecta_carryover', 'global');
    const carryoverProjection = database
      .prepare(
        "SELECT amount_projection AS amountProjection FROM trifecta_carryover WHERE id = 'global'",
      )
      .get() as { amountProjection: bigint } | undefined;
    const carryoverBalance = ledger.balance(carryoverAccountId);
    if (
      carryoverProjection === undefined ||
      carryoverProjection.amountProjection !== carryoverBalance
    ) {
      throw new Error('Carryover projection does not match its ledger balance.');
    }
    settlement = settleTrifectaPool({
      ...common,
      winningSelection: winningSelections[0]!,
      carryoverAccountId,
      carryoverBalance,
    });
  } else {
    settlement = settleParimutuelPool({
      ...common,
      winningSelections,
    });
  }

  ledger.post({
    kind: 'pool_settlement',
    referenceType: 'pool',
    referenceId: pool.id,
    idempotencyKey: `settlement:${input.raceId}:${pool.poolType}:${String(input.raceVersion)}`,
    description: `${pool.poolType} pool settlement`,
    entries: settlement.ledgerEntries,
  });
  database.prepare('UPDATE seed_positions SET payout = 0 WHERE pool_id = ?').run(pool.id);
  const updateSeedPayout = database.prepare(
    'UPDATE seed_positions SET payout = ? WHERE pool_id = ? AND selection_code = ?',
  );
  const payoutByTicket = new Map<string, bigint>();
  for (const payout of settlement.payouts) {
    if (payout.recipientType === 'user') {
      payoutByTicket.set(
        payout.recipientId,
        (payoutByTicket.get(payout.recipientId) ?? 0n) + payout.amount,
      );
    } else {
      updateSeedPayout.run(payout.amount, pool.id, payout.recipientId);
    }
  }
  const updateTicket = database.prepare(
    `UPDATE bets SET status = ?, payout = ?, settled_at = ?
     WHERE id = ? AND status = 'open'`,
  );
  for (const ticket of tickets) {
    const payout = payoutByTicket.get(ticket.id) ?? 0n;
    const result = updateTicket.run(
      payout > 0n ? 'won' : 'lost',
      payout,
      BigInt(input.at),
      ticket.id,
    );
    if (result.changes !== 1) throw new Error('Open bet disappeared during settlement.');
  }
  database
    .prepare("UPDATE bet_pools SET status = 'settled', finalized_at = ? WHERE id = ?")
    .run(BigInt(input.at), pool.id);
  if (carryoverAccountId !== undefined) {
    database
      .prepare(
        `UPDATE trifecta_carryover SET amount_projection = ?, updated_at = ?
         WHERE id = 'global'`,
      )
      .run(ledger.balance(carryoverAccountId), BigInt(input.at));
  }
}

function loadSeedPositions(database: Database.Database, poolId: string): readonly SeedPosition[] {
  return (
    database
      .prepare(
        `SELECT selection_code AS selectionCode, stake
         FROM seed_positions WHERE pool_id = ? ORDER BY selection_code`,
      )
      .all(poolId) as SeedRow[]
  ).map((row) => ({ selectionCode: row.selectionCode, stake: money(row.stake) }));
}

function findAccount(
  database: Database.Database,
  accountType: string,
  ownerKey: string,
): AccountId {
  const row = database
    .prepare('SELECT id FROM accounts WHERE account_type = ? AND owner_key = ?')
    .get(accountType, ownerKey) as { id: string } | undefined;
  if (row === undefined) throw new Error(`Account missing: ${accountType}:${ownerKey}`);
  return identifier(row.id);
}
