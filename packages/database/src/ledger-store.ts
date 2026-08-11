import type Database from 'better-sqlite3';
import { assertBalancedTransaction, type LedgerTransactionDraft } from '@jcb/economy';
import {
  DomainError,
  identifier,
  money,
  type AccountId,
  type LedgerTransactionId,
  type Money,
} from '@jcb/domain';
import { ulid } from 'ulid';

export interface PostedLedgerTransaction {
  readonly id: LedgerTransactionId;
  readonly wasDuplicate: boolean;
}

interface IdRow {
  readonly id: string;
}

interface TransactionRow extends IdRow {
  readonly kind: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly description: string;
}

interface BalanceRow {
  readonly amount: bigint;
}

export class SqliteLedgerStore {
  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
  ) {}

  public createAccount(input: {
    readonly id?: AccountId;
    readonly ownerType: string;
    readonly ownerKey: string;
    readonly accountType: string;
  }): AccountId {
    const id = input.id ?? identifier<'AccountId'>(ulid());
    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT OR IGNORE INTO accounts
           (id, owner_type, owner_key, account_type, currency, created_at)
           VALUES (?, ?, ?, ?, 'RUP', ?)`,
        )
        .run(id, input.ownerType, input.ownerKey, input.accountType, BigInt(this.now()));
      const row = this.database
        .prepare(
          `SELECT id FROM accounts
           WHERE currency = 'RUP' AND account_type = ? AND owner_key = ?`,
        )
        .get(input.accountType, input.ownerKey) as IdRow | undefined;
      if (row === undefined) throw new Error('Account could not be created.');
      this.database
        .prepare(
          `INSERT OR IGNORE INTO account_balances (account_id, amount, updated_at)
           VALUES (?, 0, ?)`,
        )
        .run(row.id, BigInt(this.now()));
      return identifier<'AccountId'>(row.id);
    });
    return transaction.immediate();
  }

  public post(transactionDraft: LedgerTransactionDraft): PostedLedgerTransaction {
    assertBalancedTransaction(transactionDraft);
    const run = this.database.transaction((): PostedLedgerTransaction => {
      const duplicate = this.database
        .prepare(
          `SELECT id, kind, reference_type AS referenceType, reference_id AS referenceId,
                  description
           FROM ledger_transactions WHERE idempotency_key = ?`,
        )
        .get(transactionDraft.idempotencyKey) as TransactionRow | undefined;
      if (duplicate !== undefined) {
        this.assertDuplicateMatches(duplicate, transactionDraft);
        return { id: identifier(duplicate.id), wasDuplicate: true };
      }
      const transactionId = identifier<'LedgerTransactionId'>(ulid());
      const now = BigInt(this.now());
      this.ensureSufficientFunds(transactionDraft);
      this.database
        .prepare(
          `INSERT INTO ledger_transactions
           (id, kind, reference_type, reference_id, idempotency_key, description, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          transactionId,
          transactionDraft.kind,
          transactionDraft.referenceType,
          transactionDraft.referenceId,
          transactionDraft.idempotencyKey,
          transactionDraft.description,
          now,
        );
      const insertEntry = this.database.prepare(
        `INSERT INTO ledger_entries
         (id, transaction_id, account_id, amount, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const updateBalance = this.database.prepare(
        `UPDATE account_balances
         SET amount = amount + ?, updated_at = ?
         WHERE account_id = ?`,
      );
      for (const entry of transactionDraft.entries) {
        insertEntry.run(ulid(), transactionId, entry.accountId, entry.amount, now);
        const result = updateBalance.run(entry.amount, now, entry.accountId);
        if (result.changes !== 1) throw new Error(`Balance projection missing: ${entry.accountId}`);
      }
      const persistedSum = this.database
        .prepare(
          'SELECT COALESCE(SUM(amount), 0) AS amount FROM ledger_entries WHERE transaction_id = ?',
        )
        .get(transactionId) as BalanceRow;
      if (persistedSum.amount !== 0n)
        throw new Error('Persisted ledger transaction is imbalanced.');
      return { id: transactionId, wasDuplicate: false };
    });
    return run.immediate();
  }

  public balance(accountId: AccountId): Money {
    const row = this.database
      .prepare('SELECT amount FROM account_balances WHERE account_id = ?')
      .get(accountId) as BalanceRow | undefined;
    if (row === undefined) throw new Error(`Unknown account: ${accountId}`);
    return money(row.amount);
  }

  public assertProjectionIntegrity(): void {
    const differences = this.database
      .prepare(
        `SELECT ab.account_id
         FROM account_balances ab
         LEFT JOIN (
           SELECT account_id, SUM(amount) AS expected
           FROM ledger_entries
           GROUP BY account_id
         ) le ON le.account_id = ab.account_id
         WHERE ab.amount <> COALESCE(le.expected, 0)`,
      )
      .all();
    const imbalancedTransactions = this.database
      .prepare(
        `SELECT transaction_id
         FROM ledger_entries
         GROUP BY transaction_id
         HAVING COALESCE(SUM(amount), 0) <> 0`,
      )
      .all();
    if (differences.length > 0 || imbalancedTransactions.length > 0) {
      throw new Error(
        `Ledger integrity mismatch: ${String(differences.length)} account projection(s), ` +
          `${String(imbalancedTransactions.length)} imbalanced transaction(s).`,
      );
    }
  }

  private ensureSufficientFunds(transactionDraft: LedgerTransactionDraft): void {
    const outgoingByAccount = new Map<string, bigint>();
    for (const entry of transactionDraft.entries) {
      if (entry.amount < 0n) {
        outgoingByAccount.set(
          entry.accountId,
          (outgoingByAccount.get(entry.accountId) ?? 0n) - entry.amount,
        );
      }
    }
    for (const [accountId, outgoing] of outgoingByAccount) {
      const account = this.database
        .prepare(
          `SELECT a.account_type AS accountType, ab.amount
           FROM accounts a
           JOIN account_balances ab ON ab.account_id = a.id
           WHERE a.id = ?`,
        )
        .get(accountId) as { accountType: string; amount: bigint } | undefined;
      if (account === undefined) throw new Error(`Unknown account: ${accountId}`);
      if (
        account.accountType !== 'issuance' &&
        account.accountType !== 'burn' &&
        account.amount < outgoing
      ) {
        throw new Error(`Insufficient funds in account ${accountId}.`);
      }
    }
  }

  private assertDuplicateMatches(
    existing: TransactionRow,
    requested: LedgerTransactionDraft,
  ): void {
    const entries = this.database
      .prepare(
        `SELECT account_id AS accountId, amount
         FROM ledger_entries WHERE transaction_id = ?
         ORDER BY account_id, amount`,
      )
      .all(existing.id) as Array<{ accountId: string; amount: bigint }>;
    const requestedEntries = requested.entries
      .map((entry) => ({ accountId: String(entry.accountId), amount: entry.amount }))
      .sort((left, right) =>
        left.accountId === right.accountId
          ? left.amount < right.amount
            ? -1
            : left.amount > right.amount
              ? 1
              : 0
          : left.accountId.localeCompare(right.accountId),
      );
    const matches =
      existing.kind === requested.kind &&
      existing.referenceType === requested.referenceType &&
      existing.referenceId === requested.referenceId &&
      existing.description === requested.description &&
      entries.length === requestedEntries.length &&
      entries.every(
        (entry, index) =>
          entry.accountId === requestedEntries[index]?.accountId &&
          entry.amount === requestedEntries[index]?.amount,
      );
    if (!matches) {
      throw new DomainError(
        'DUPLICATE_OPERATION',
        'Idempotency key was already used for a different ledger transaction.',
      );
    }
  }
}
