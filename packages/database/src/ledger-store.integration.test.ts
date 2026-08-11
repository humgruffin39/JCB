import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { identifier, money } from '@jcb/domain';
import { transfer } from '@jcb/economy';
import { openDatabase } from './connection.js';
import { SqliteLedgerStore } from './ledger-store.js';
import { applyMigrations } from './migrations.js';

describe('SQLite ledger store', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('posts balances atomically, remains idempotent, and rebuilds projections', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jcb-ledger-'));
    directories.push(directory);
    const database = openDatabase(join(directory, 'ledger.sqlite'));
    const migrationsDirectory = join(
      dirname(dirname(fileURLToPath(import.meta.url))),
      'migrations',
    );
    applyMigrations(database, migrationsDirectory, 1);
    const ledger = new SqliteLedgerStore(database, () => 2);
    const issuance = ledger.createAccount({
      ownerType: 'system',
      ownerKey: 'issuance',
      accountType: 'issuance',
    });
    const bank = ledger.createAccount({
      ownerType: 'system',
      ownerKey: 'central',
      accountType: 'central_bank',
    });
    const user = ledger.createAccount({
      id: identifier('user-account'),
      ownerType: 'user',
      ownerKey: 'user-1',
      accountType: 'user',
    });
    ledger.post({
      kind: 'issuance',
      referenceType: 'system',
      referenceId: 'initial',
      idempotencyKey: 'issuance:initial',
      description: 'Initial supply',
      entries: transfer(issuance, bank, money(10_000_000n)),
    });
    const grant = {
      kind: 'initial_grant',
      referenceType: 'user',
      referenceId: 'user-1',
      idempotencyKey: 'initial-grant:user-1',
      description: 'Initial user grant',
      entries: transfer(bank, user, money(50_000n)),
    } as const;
    expect(ledger.post(grant).wasDuplicate).toBe(false);
    expect(ledger.post(grant).wasDuplicate).toBe(true);
    expect(() =>
      ledger.post({
        ...grant,
        description: 'Conflicting reuse of the same key',
      }),
    ).toThrow(/different ledger transaction/i);
    expect(ledger.balance(user)).toBe(50_000n);
    expect(ledger.balance(bank)).toBe(9_950_000n);
    expect(() => ledger.assertProjectionIntegrity()).not.toThrow();
    database.close();
  });

  it('rolls back an imbalanced transaction before writing', () => {
    const database = openDatabase(':memory:');
    const migrationsDirectory = join(
      dirname(dirname(fileURLToPath(import.meta.url))),
      'migrations',
    );
    applyMigrations(database, migrationsDirectory, 1);
    const ledger = new SqliteLedgerStore(database, () => 2);
    const accountId = ledger.createAccount({
      ownerType: 'system',
      ownerKey: 'issuance',
      accountType: 'issuance',
    });
    expect(() =>
      ledger.post({
        kind: 'broken',
        referenceType: 'test',
        referenceId: 'broken',
        idempotencyKey: 'broken',
        description: 'Broken',
        entries: [{ accountId, amount: money(1n) }],
      }),
    ).toThrow();
    expect(
      (
        database.prepare('SELECT COUNT(*) AS count FROM ledger_transactions').get() as {
          count: bigint;
        }
      ).count,
    ).toBe(0n);
    database.close();
  });
});
