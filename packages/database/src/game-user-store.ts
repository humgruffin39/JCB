import type Database from 'better-sqlite3';
import { DomainError, identifier, money } from '@jcb/domain';
import type { AccountId } from '@jcb/domain';
import { transfer } from '@jcb/economy';
import { ulid } from 'ulid';
import type { SqliteLedgerStore } from './ledger-store.js';
import type { RegisteredUser } from './game-store-types.js';

export class SqliteGameUserStore {
  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
    private readonly ledger: SqliteLedgerStore,
  ) {}

  public initializeEconomy(initialAdminDiscordIds: readonly string[]): void {
    const run = this.database.transaction(() => {
      const issuance = this.ledger.createAccount({
        ownerType: 'system',
        ownerKey: 'global',
        accountType: 'issuance',
      });
      const centralBank = this.ledger.createAccount({
        ownerType: 'system',
        ownerKey: 'global',
        accountType: 'central_bank',
      });
      const carryover = this.ledger.createAccount({
        ownerType: 'system',
        ownerKey: 'global',
        accountType: 'trifecta_carryover',
      });
      this.ledger.post({
        kind: 'issuance',
        referenceType: 'system',
        referenceId: 'initial-supply',
        idempotencyKey: 'issuance:initial:10000000',
        description: 'Initial 10,000,000 rupee supply',
        entries: transfer(issuance, centralBank, money(10_000_000n)),
      });
      this.database
        .prepare(
          `INSERT OR IGNORE INTO trifecta_carryover
           (id, account_id, amount_projection, updated_at) VALUES ('global', ?, 0, ?)`,
        )
        .run(carryover, BigInt(this.now()));
      const insertAdmin = this.database.prepare(
        `INSERT OR IGNORE INTO admin_allowlist
         (discord_user_id, added_by_user_id, created_at) VALUES (?, NULL, ?)`,
      );
      for (const discordUserId of initialAdminDiscordIds) {
        insertAdmin.run(discordUserId, BigInt(this.now()));
      }
    });
    run.immediate();
  }

  public registerUser(
    discordUserId: string,
    displayName: string,
    isGuildMember: boolean,
  ): RegisteredUser {
    if (!isGuildMember) throw new DomainError('BETTING_CLOSED', 'Guild membership is required.');
    const run = this.database.transaction((): RegisteredUser => {
      const existing = this.database
        .prepare('SELECT id FROM users WHERE discord_user_id = ?')
        .get(discordUserId) as { id: string } | undefined;
      if (existing !== undefined) {
        this.database
          .prepare(
            `UPDATE users SET display_name = ?, status = 'active',
             last_guild_check_at = ?, updated_at = ? WHERE id = ?`,
          )
          .run(displayName, BigInt(this.now()), BigInt(this.now()), existing.id);
        return {
          id: existing.id,
          accountId: this.findUserAccount(existing.id),
          wasCreated: false,
        };
      }
      const userId = ulid();
      const now = BigInt(this.now());
      this.database
        .prepare(
          `INSERT INTO users
           (id, discord_user_id, display_name, status, created_at, updated_at, last_guild_check_at)
           VALUES (?, ?, ?, 'active', ?, ?, ?)`,
        )
        .run(userId, discordUserId, displayName, now, now, now);
      const accountId = this.ledger.createAccount({
        ownerType: 'user',
        ownerKey: userId,
        accountType: 'user',
      });
      const centralBank = this.findSystemAccount('central_bank');
      this.ledger.post({
        kind: 'initial_grant',
        referenceType: 'user',
        referenceId: userId,
        idempotencyKey: `initial-grant:${discordUserId}`,
        description: 'One-time new user grant',
        entries: transfer(centralBank, accountId, money(50_000n)),
      });
      return { id: userId, accountId, wasCreated: true };
    });
    return run.immediate();
  }

  private findSystemAccount(accountType: string): AccountId {
    const row = this.database
      .prepare("SELECT id FROM accounts WHERE account_type = ? AND owner_key = 'global'")
      .get(accountType) as { id: string } | undefined;
    if (row === undefined) throw new Error(`System account missing: ${accountType}`);
    return identifier(row.id);
  }

  private findUserAccount(userId: string): AccountId {
    const row = this.database
      .prepare("SELECT id FROM accounts WHERE account_type = 'user' AND owner_key = ?")
      .get(userId) as { id: string } | undefined;
    if (row === undefined) throw new Error('User account missing.');
    return identifier(row.id);
  }
}
