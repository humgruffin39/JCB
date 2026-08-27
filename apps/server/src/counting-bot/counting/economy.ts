import { SqliteGameStore, type SqliteDatabase } from '@jcb/database';
import { identifier, money, type AccountId } from '@jcb/domain';
import { transfer } from '@jcb/economy';
import type { CountMessage } from './message.js';

export type CountOutcome = 'accepted' | 'failed';

export interface CountEconomy {
  readonly apply: (message: CountMessage, outcome: CountOutcome) => void;
}

const acceptedReward = 10n;
const failurePenalty = 5_000n;

export class SqliteCountEconomy implements CountEconomy {
  private readonly game: SqliteGameStore;
  private readonly bankAccountId: AccountId;

  public constructor(
    private readonly database: SqliteDatabase,
    private readonly now: () => number,
  ) {
    this.game = new SqliteGameStore(database, now);
    const bank = database
      .prepare(
        "SELECT id FROM accounts WHERE account_type = 'central_bank' AND owner_key = 'global'",
      )
      .get() as { id: string } | undefined;
    if (bank === undefined) throw new Error('Central bank account is missing.');
    this.bankAccountId = identifier(bank.id);
  }

  public apply(message: CountMessage, outcome: CountOutcome): void {
    const idempotencyKey = `counting-economy:${message.id}`;
    if (this.wasApplied(idempotencyKey, outcome)) return;

    const accountId = this.findOrCreateAccount(message);

    const amount =
      outcome === 'accepted'
        ? acceptedReward
        : bigintMinimum(this.game.ledgerStore().balance(accountId), failurePenalty);
    if (amount === 0n) {
      this.database
        .prepare(
          `INSERT INTO idempotency_records (key, operation, result_reference_id, created_at)
           VALUES (?, 'counting_failed', NULL, ?)`,
        )
        .run(idempotencyKey, BigInt(this.now()));
      return;
    }

    this.game.ledgerStore().post({
      kind: outcome === 'accepted' ? 'counting_reward' : 'counting_penalty',
      referenceType: 'discord_message',
      referenceId: message.id,
      idempotencyKey,
      description: outcome === 'accepted' ? 'Successful count reward' : 'Failed count penalty',
      entries:
        outcome === 'accepted'
          ? transfer(this.bankAccountId, accountId, money(amount))
          : transfer(accountId, this.bankAccountId, money(amount)),
    });
  }

  private findOrCreateAccount(message: CountMessage): AccountId {
    const existing = this.database
      .prepare(
        `SELECT a.id
         FROM users u
         JOIN accounts a ON a.owner_type = 'user' AND a.owner_key = u.id
                        AND a.account_type = 'user'
         WHERE u.discord_user_id = ?`,
      )
      .get(message.authorId) as { id: string } | undefined;
    if (existing !== undefined) return identifier(existing.id);
    return this.game.registerUser(message.authorId, message.authorDisplayName, true).accountId;
  }

  private wasApplied(idempotencyKey: string, outcome: CountOutcome): boolean {
    const ledger = this.database
      .prepare('SELECT kind FROM ledger_transactions WHERE idempotency_key = ?')
      .get(idempotencyKey) as { kind: string } | undefined;
    const expectedKind = outcome === 'accepted' ? 'counting_reward' : 'counting_penalty';
    if (ledger !== undefined) {
      if (ledger.kind !== expectedKind) {
        throw new Error('Count outcome conflicts with its ledger entry.');
      }
      return true;
    }
    const zeroPenalty = this.database
      .prepare('SELECT operation FROM idempotency_records WHERE key = ?')
      .get(idempotencyKey) as { operation: string } | undefined;
    if (zeroPenalty === undefined) return false;
    if (outcome !== 'failed' || zeroPenalty.operation !== 'counting_failed') {
      throw new Error('Count outcome conflicts with its idempotency record.');
    }
    return true;
  }
}

function bigintMinimum(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
