import { DomainError, money, type AccountId, type Money } from '@jcb/domain';
import { allocateProRata, type Allocation, type AllocationClaim } from './allocate-pro-rata.js';
import { transfer, type LedgerEntryDraft } from './ledger.js';

export interface OpenTicket {
  readonly id: string;
  readonly accountId: AccountId;
  readonly selectionCode: string;
  readonly stake: Money;
  readonly createdAt: number;
}

export interface SeedPosition {
  readonly selectionCode: string;
  readonly stake: Money;
}

export interface SettlementPayout {
  readonly recipientType: 'user' | 'seed';
  readonly recipientId: string;
  readonly accountId: AccountId;
  readonly amount: Money;
}

export interface WinSettlementInput {
  readonly poolAccountId: AccountId;
  readonly centralBankAccountId: AccountId;
  readonly winningSelection: string;
  readonly poolBalance: Money;
  readonly tickets: readonly OpenTicket[];
  readonly seedPositions: readonly SeedPosition[];
}

export interface TrifectaSettlementInput extends WinSettlementInput {
  readonly carryoverAccountId: AccountId;
  readonly carryoverBalance: Money;
}

export interface ParimutuelSettlementInput {
  readonly poolAccountId: AccountId;
  readonly centralBankAccountId: AccountId;
  readonly winningSelections: readonly string[];
  readonly poolBalance: Money;
  readonly tickets: readonly OpenTicket[];
  readonly seedPositions: readonly SeedPosition[];
}

export interface SettlementResult {
  readonly payouts: readonly SettlementPayout[];
  readonly ledgerEntries: readonly LedgerEntryDraft[];
  readonly nextCarryover: Money;
  readonly hasUserWinner: boolean;
}

export function settleWinPool(input: WinSettlementInput): SettlementResult {
  return settleParimutuelPool({
    ...input,
    winningSelections: [input.winningSelection],
  });
}

export function settleParimutuelPool(input: ParimutuelSettlementInput): SettlementResult {
  assertPoolBalance(input);
  if (input.winningSelections.length === 0) {
    throw new DomainError('INVALID_SELECTION', 'At least one winning selection is required.');
  }
  const winningSelectionSet = new Set(input.winningSelections);
  if (winningSelectionSet.size !== input.winningSelections.length) {
    throw new DomainError('INVALID_SELECTION', 'Winning selections must be distinct.');
  }
  const winningTickets = input.tickets.filter((ticket) =>
    winningSelectionSet.has(ticket.selectionCode),
  );
  const winningSeeds = input.seedPositions.filter((position) =>
    winningSelectionSet.has(position.selectionCode),
  );
  if (winningSeeds.length === 0) {
    throw new DomainError('INVALID_SELECTION', 'Winning seed position is missing.');
  }

  // Every winning selection is paid from its own equal share of the pool, the way
  // a place or wide pool works at a real racecourse. Pooling the winners together
  // would pay the same rate on a longshot and on the favourite, and would make the
  // displayed per-selection odds unreachable.
  const claimsBySelection = new Map<string, AllocationClaim[]>(
    [...winningSelectionSet].map((selectionCode) => [selectionCode, []]),
  );
  for (const ticket of winningTickets) {
    if (ticket.stake <= 0n) continue;
    claimsBySelection.get(ticket.selectionCode)!.push({
      id: `user:${ticket.id}`,
      weight: ticket.stake,
      tieBreaker: String(ticket.createdAt).padStart(16, '0'),
    });
  }
  for (const seed of winningSeeds) {
    if (seed.stake <= 0n) continue;
    claimsBySelection.get(seed.selectionCode)!.push({
      id: `seed:${seed.selectionCode}`,
      weight: seed.stake,
      tieBreaker: `seed:${seed.selectionCode}`,
    });
  }
  const fundedSelections = [...claimsBySelection.entries()]
    .filter(([, claims]) => claims.length > 0)
    .map(([selectionCode]) => selectionCode)
    .sort((left, right) => left.localeCompare(right));

  const winningTicketsById = new Map(winningTickets.map((ticket) => [ticket.id, ticket]));
  const toPayout = (allocation: Allocation): SettlementPayout => {
    if (allocation.id.startsWith('user:')) {
      const ticketId = allocation.id.slice('user:'.length);
      const ticket = winningTicketsById.get(ticketId);
      if (ticket === undefined) throw new Error('Allocated ticket disappeared.');
      return {
        recipientType: 'user',
        recipientId: ticket.id,
        accountId: ticket.accountId,
        amount: allocation.amount,
      };
    }
    return {
      recipientType: 'seed',
      recipientId: allocation.id.slice('seed:'.length),
      accountId: input.centralBankAccountId,
      amount: allocation.amount,
    };
  };

  let payouts: readonly SettlementPayout[];
  if (fundedSelections.length === 0) {
    // Nothing was ever staked on a winning selection. The balance is seed money,
    // so it returns to the central bank rather than staying stranded in the pool.
    payouts =
      input.poolBalance > 0n
        ? [
            {
              recipientType: 'seed',
              recipientId: input.winningSelections[0]!,
              accountId: input.centralBankAccountId,
              amount: input.poolBalance,
            },
          ]
        : [];
  } else {
    const subPools = allocateProRata(
      input.poolBalance,
      fundedSelections.map((selectionCode) => ({
        id: selectionCode,
        weight: money(1n),
        tieBreaker: selectionCode,
      })),
    );
    payouts = subPools.flatMap((subPool) =>
      allocateProRata(subPool.amount, claimsBySelection.get(subPool.id)!).map(toPayout),
    );
  }

  return {
    payouts,
    ledgerEntries: payouts
      .filter((payout) => payout.amount > 0n)
      .flatMap((payout) => transfer(input.poolAccountId, payout.accountId, payout.amount)),
    nextCarryover: money(0n),
    hasUserWinner: winningTickets.length > 0,
  };
}

export function settleTrifectaPool(input: TrifectaSettlementInput): SettlementResult {
  assertPoolBalance(input);
  const winningTickets = input.tickets.filter(
    (ticket) => ticket.selectionCode === input.winningSelection,
  );
  if (winningTickets.length === 0) {
    const seedLiquidity = input.seedPositions.reduce((sum, position) => sum + position.stake, 0n);
    const userStake = input.tickets.reduce((sum, ticket) => sum + ticket.stake, 0n);
    const entries = [
      ...(seedLiquidity > 0n
        ? transfer(input.poolAccountId, input.centralBankAccountId, money(seedLiquidity))
        : []),
      ...(userStake > 0n
        ? transfer(input.poolAccountId, input.carryoverAccountId, money(userStake))
        : []),
    ];
    const seedPayouts = input.seedPositions.map((position): SettlementPayout => ({
      recipientType: 'seed',
      recipientId: position.selectionCode,
      accountId: input.centralBankAccountId,
      amount: position.stake,
    }));
    return {
      payouts: seedPayouts,
      ledgerEntries: entries,
      nextCarryover: money(input.carryoverBalance + userStake),
      hasUserWinner: false,
    };
  }

  const base = settleParimutuelPool({
    ...input,
    winningSelections: [input.winningSelection],
  });
  const carryoverClaims = winningTickets.map((ticket) => ({
    id: ticket.id,
    weight: ticket.stake,
    tieBreaker: String(ticket.createdAt).padStart(16, '0'),
  }));
  const winningTicketsById = new Map(winningTickets.map((ticket) => [ticket.id, ticket]));
  const carryoverPayouts = allocateProRata(input.carryoverBalance, carryoverClaims).map(
    (allocation): SettlementPayout => {
      const ticket = winningTicketsById.get(allocation.id);
      if (ticket === undefined) throw new Error('Allocated ticket disappeared.');
      return {
        recipientType: 'user',
        recipientId: ticket.id,
        accountId: ticket.accountId,
        amount: allocation.amount,
      };
    },
  );
  return {
    payouts: [...base.payouts, ...carryoverPayouts],
    ledgerEntries: [
      ...base.ledgerEntries,
      ...carryoverPayouts
        .filter((payout) => payout.amount > 0n)
        .flatMap((payout) => transfer(input.carryoverAccountId, payout.accountId, payout.amount)),
    ],
    nextCarryover: money(0n),
    hasUserWinner: true,
  };
}

function assertPoolBalance(input: {
  readonly poolBalance: Money;
  readonly tickets: readonly OpenTicket[];
  readonly seedPositions: readonly SeedPosition[];
}): void {
  const seedTotal = input.seedPositions.reduce((sum, position) => sum + position.stake, 0n);
  const userTotal = input.tickets.reduce((sum, ticket) => sum + ticket.stake, 0n);
  if (seedTotal + userTotal !== input.poolBalance) {
    throw new Error('Pool balance does not match seed liquidity and user stakes.');
  }
}
