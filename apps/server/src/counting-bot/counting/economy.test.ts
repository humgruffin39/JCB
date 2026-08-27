import { applyMigrations, openDatabase, SqliteGameStore } from '@jcb/database';
import { identifier, money } from '@jcb/domain';
import { transfer } from '@jcb/economy';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { message } from '../tests/helpers.js';
import { SqliteCountEconomy } from './economy.js';

const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

function createEconomy() {
  const database = openDatabase(':memory:');
  applyMigrations(database, join(repositoryRoot, 'packages', 'database', 'migrations'), 1);
  const game = new SqliteGameStore(database, () => 1);
  game.initializeEconomy([]);
  return { database, economy: new SqliteCountEconomy(database, () => 2), game };
}

describe('counting economy', () => {
  it('creates an account and rewards an accepted count exactly once', () => {
    const { database, economy, game } = createEconomy();
    const accepted = message({ id: '100', authorId: '30', authorDisplayName: '数取太郎' });

    economy.apply(accepted, 'accepted');
    economy.apply(accepted, 'accepted');

    const user = game.registerUser('30', '数取太郎', true);
    expect(game.ledgerStore().balance(user.accountId)).toBe(50_010n);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM ledger_transactions WHERE kind = 'counting_reward'")
        .get(),
    ).toEqual({ count: 1n });
    database.close();
  });

  it('deducts a failed count exactly once', () => {
    const { database, economy, game } = createEconomy();
    const user = game.registerUser('30', '数取太郎', true);
    const failed = message({ id: '101', authorId: '30', authorDisplayName: '数取太郎' });

    economy.apply(failed, 'failed');
    economy.apply(failed, 'failed');

    expect(game.ledgerStore().balance(user.accountId)).toBe(45_000n);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM ledger_transactions WHERE kind = 'counting_penalty'",
        )
        .get(),
    ).toEqual({ count: 1n });
    database.close();
  });

  it('stops at zero when the account has less than the failure penalty', () => {
    const { database, economy, game } = createEconomy();
    const user = game.registerUser('30', '数取太郎', true);
    const bank = database
      .prepare(
        "SELECT id FROM accounts WHERE account_type = 'central_bank' AND owner_key = 'global'",
      )
      .get() as { id: string };
    game.ledgerStore().post({
      kind: 'test_balance_setup',
      referenceType: 'user',
      referenceId: user.id,
      idempotencyKey: 'test-counting-low-balance',
      description: 'Set up a low balance',
      entries: transfer(user.accountId, identifier(bank.id), money(49_000n)),
    });

    economy.apply(message({ id: '102', authorId: '30' }), 'failed');

    expect(game.ledgerStore().balance(user.accountId)).toBe(0n);
    database.close();
  });
});
