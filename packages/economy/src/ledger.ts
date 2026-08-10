import { DomainError, money, type AccountId, type Money } from '@jcb/domain';

export interface LedgerEntryDraft {
  readonly accountId: AccountId;
  readonly amount: Money;
}

export interface LedgerTransactionDraft {
  readonly kind: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly idempotencyKey: string;
  readonly description: string;
  readonly entries: readonly LedgerEntryDraft[];
}

export function sumLedgerEntries(entries: readonly LedgerEntryDraft[]): Money {
  return money(entries.reduce((sum, entry) => sum + entry.amount, 0n));
}

export function assertBalancedTransaction(
  transaction: LedgerTransactionDraft,
): LedgerTransactionDraft {
  if (transaction.entries.length < 2) {
    throw new DomainError('INVALID_MONEY', 'A ledger transaction needs at least two entries.');
  }
  if (sumLedgerEntries(transaction.entries) !== 0n) {
    throw new DomainError('INVALID_MONEY', 'Ledger transaction entries must sum to zero.');
  }
  if (transaction.entries.some((entry) => entry.amount === 0n)) {
    throw new DomainError('INVALID_MONEY', 'Zero-value ledger entries are not allowed.');
  }
  return transaction;
}

export function transfer(
  fromAccountId: AccountId,
  toAccountId: AccountId,
  amount: Money,
): readonly LedgerEntryDraft[] {
  if (amount <= 0n) {
    throw new DomainError('INVALID_MONEY', 'Transfer amount must be positive.');
  }
  return [
    { accountId: fromAccountId, amount: money(0n - amount) },
    { accountId: toAccountId, amount },
  ];
}
