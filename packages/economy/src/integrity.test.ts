import fc from 'fast-check';
import { identifier, money, timestamp } from '@jcb/domain';
import { allocateProRata } from './allocate-pro-rata.js';
import { assertBalancedTransaction, sumLedgerEntries, transfer } from './ledger.js';
import { settleTrifectaPool, settleWinPool } from './settlement.js';
import { estimatedGrossPayout, validatePurchase } from './betting.js';

describe('economy integrity', () => {
  it('conserves money in every transfer', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10_000_000n }), (amount) => {
        const entries = transfer(identifier('from'), identifier('to'), money(amount));
        expect(sumLedgerEntries(entries)).toBe(0n);
      }),
    );
  });

  it('allocates every rupee deterministically', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        fc.array(fc.bigInt({ min: 1n, max: 100_000n }), { minLength: 1, maxLength: 20 }),
        (total, weights) => {
          const claims = weights.map((weight, index) => ({
            id: String(index),
            weight: money(weight),
            tieBreaker: String(index).padStart(4, '0'),
          }));
          const first = allocateProRata(money(total), claims);
          const second = allocateProRata(money(total), claims);
          expect(first).toEqual(second);
          expect(first.reduce((sum, allocation) => sum + allocation.amount, 0n)).toBe(total);
        },
      ),
    );
  });

  it('rejects duplicate allocation claim IDs', () => {
    expect(() =>
      allocateProRata(money(100n), [
        { id: 'duplicate', weight: money(1n), tieBreaker: '1' },
        { id: 'duplicate', weight: money(1n), tieBreaker: '2' },
      ]),
    ).toThrow(/unique/i);
  });

  it('carries over all user trifecta stakes when there is no user winner', () => {
    const poolAccountId = identifier<'AccountId'>('pool');
    const centralBankAccountId = identifier<'AccountId'>('bank');
    const carryoverAccountId = identifier<'AccountId'>('carry');
    const result = settleTrifectaPool({
      poolAccountId,
      centralBankAccountId,
      carryoverAccountId,
      winningSelection: '1-2-3',
      poolBalance: money(1_500n),
      carryoverBalance: money(700n),
      tickets: [
        {
          id: 'ticket',
          accountId: identifier('user-account'),
          selectionCode: '2-1-3',
          stake: money(500n),
          createdAt: 1,
        },
      ],
      seedPositions: [{ selectionCode: '1-2-3', stake: money(1_000n) }],
    });
    expect(result.hasUserWinner).toBe(false);
    expect(result.nextCarryover).toBe(1_200n);
    expect(sumLedgerEntries(result.ledgerEntries)).toBe(0n);
    expect(result.payouts).toEqual([
      {
        recipientType: 'seed',
        recipientId: '1-2-3',
        accountId: centralBankAccountId,
        amount: 1_000n,
      },
    ]);
  });

  it('rejects an imbalanced ledger transaction', () => {
    expect(() =>
      assertBalancedTransaction({
        kind: 'broken',
        referenceType: 'test',
        referenceId: 'test',
        idempotencyKey: 'test',
        description: 'test',
        entries: [{ accountId: identifier('account'), amount: money(1n) }],
      }),
    ).toThrow();
  });

  it('includes self dilution in the purchase payout estimate', () => {
    expect(estimatedGrossPayout(money(1_000n), money(10_000n), money(2_000n))).toBe(3_666n);
  });

  it('allocates the entire win pool between user and seed winners', () => {
    const result = settleWinPool({
      poolAccountId: identifier('win-pool'),
      centralBankAccountId: identifier('bank'),
      winningSelection: '1',
      poolBalance: money(1_500n),
      tickets: [
        {
          id: 'winner',
          accountId: identifier('winner-account'),
          selectionCode: '1',
          stake: money(500n),
          createdAt: 1,
        },
      ],
      seedPositions: [{ selectionCode: '1', stake: money(1_000n) }],
    });
    expect(result.payouts.reduce((sum, payout) => sum + payout.amount, 0n)).toBe(1_500n);
    expect(sumLedgerEntries(result.ledgerEntries)).toBe(0n);
  });

  it('rejects a pool balance that does not match persisted stakes', () => {
    expect(() =>
      settleWinPool({
        poolAccountId: identifier('win-pool'),
        centralBankAccountId: identifier('bank'),
        winningSelection: '1',
        poolBalance: money(12_344n),
        tickets: [
          {
            id: 'winner',
            accountId: identifier('winner-account'),
            selectionCode: '1',
            stake: money(500n),
            createdAt: 1,
          },
        ],
        seedPositions: [{ selectionCode: '1', stake: money(1_000n) }],
      }),
    ).toThrow(/pool balance/i);
  });

  it('rejects insufficient funds and the snapshotted per-race cap', () => {
    const valid = {
      isUserActive: true,
      isGuildMember: true,
      raceStatus: 'betting_open' as const,
      now: timestamp(1_000),
      bettingClosesAt: timestamp(2_000),
      expectedRaceVersion: 1,
      currentRaceVersion: 1,
      stake: money(500n),
      balance: money(1_000n),
      userRaceStake: money(0n),
      raceKind: 'regular' as const,
      raceBetLimit: money(700n),
      poolType: 'win' as const,
      selectionCode: '1',
    };
    expect(() => validatePurchase({ ...valid, stake: money(1_001n) })).toThrow(/balance/i);
    expect(() =>
      validatePurchase({
        ...valid,
        userRaceStake: money(300n),
        stake: money(500n),
      }),
    ).toThrow(/limit/i);
  });
});
