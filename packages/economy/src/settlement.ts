import { DomainError, money, type AccountId, type Money } from '@jcb/domain';
import { allocateProRata, type AllocationClaim } from './allocate-pro-rata.js';
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

export interface SettlementResult {
  readonly payouts: readonly SettlementPayout[];
  readonly ledgerEntries: readonly LedgerEntryDraft[];
  readonly nextCarryover: Money;
  readonly hasUserWinner: boolean;
}

export function settleWinPool(input: WinSettlementInput): SettlementResult {
  assertPoolBalance(input);
  const winningTickets = input.tickets.filter(
    (ticket) => ticket.selectionCode === input.winningSelection,
  );
  const seed = input.seedPositions.find(
    (position) => position.selectionCode === input.winningSelection,
  );
  if (seed === undefined) {
    throw new DomainError('INVALID_SELECTION', 'Winning seed position is missing.');
  }
  const claims: AllocationClaim[] = [
    ...winningTickets.map((ticket) => ({
      id: `user:${ticket.id}`,
      weight: ticket.stake,
      tieBreaker: String(ticket.createdAt).padStart(16, '0'),
    })),
    {
      id: `seed:${seed.selectionCode}`,
      weight: seed.stake,
      tieBreaker: `seed:${seed.selectionCode}`,
    },
  ];
  const allocations = allocateProRata(input.poolBalance, claims);
  const winningTicketsById = new Map(winningTickets.map((ticket) => [ticket.id, ticket]));
  const payouts = allocations.map((allocation): SettlementPayout => {
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
      recipientId: seed.selectionCode,
      accountId: input.centralBankAccountId,
      amount: allocation.amount,
    };
  });
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

  const base = settleWinPool(input);
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

function assertPoolBalance(input: WinSettlementInput): void {
  const seedTotal = input.seedPositions.reduce((sum, position) => sum + position.stake, 0n);
  const userTotal = input.tickets.reduce((sum, ticket) => sum + ticket.stake, 0n);
  if (seedTotal + userTotal !== input.poolBalance) {
    throw new Error('Pool balance does not match seed liquidity and user stakes.');
  }
}
