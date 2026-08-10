import type Database from 'better-sqlite3';
import { assertBalancedTransaction, type LedgerTransactionDraft } from '@jcb/economy';
import {
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
        .prepare('SELECT id FROM ledger_transactions WHERE idempotency_key = ?')
        .get(transactionDraft.idempotencyKey) as IdRow | undefined;
      if (duplicate !== undefined) {
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
    if (differences.length > 0) {
      throw new Error(`Balance projection mismatch for ${differences.length} account(s).`);
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
}
