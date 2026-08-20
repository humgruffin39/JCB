import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, openDatabase, SqliteGameStore } from '@jcb/database';
import { money, timestamp } from '@jcb/domain';
import { describe, expect, it, vi } from 'vitest';
import { SqliteDiscordPurchaseGateway, nextOddsRefreshAt } from './discord-purchase-gateway.js';

const migrationsDirectory = join(
  dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
  'packages',
  'database',
  'migrations',
);

describe('Discord race message debounce', () => {
  it('coalesces a burst into one aligned refresh boundary', () => {
    const refreshes = [30_001, 35_000, 59_999].map((current) => nextOddsRefreshAt(current, 30_000));
    expect(new Set(refreshes)).toEqual(new Set([60_000]));
    expect(nextOddsRefreshAt(60_000, 30_000)).toBe(90_000);
  });

  it('persists the purchased race version on the refresh job payload', async () => {
    const now = 1_800_000_000_000;
    const database = openDatabase(':memory:');
    applyMigrations(database, migrationsDirectory, now);
    const game = new SqliteGameStore(database, () => now);
    game.initializeEconomy([]);
    const user = game.registerUser('user-1', '利用者', true);
    const account = database
      .prepare("SELECT id FROM accounts WHERE owner_key = ? AND account_type = 'user'")
      .get(user.id) as { id: string };
    database
      .prepare(
        `INSERT INTO races
         (id, race_date, name, kind, status, version, distance_m, going,
          scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
          created_at, updated_at)
         VALUES ('race-1', '2026-08-20', '購入更新', 'regular', 'betting_open', 3, 1200, 'firm',
                 ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        BigInt(now + 60_000),
        BigInt(now - 60_000),
        BigInt(now + 30_000),
        BigInt(now - 60_000),
        BigInt(now),
        BigInt(now),
      );
    database
      .prepare(
        `INSERT INTO bet_pools
         (id, race_id, pool_type, account_id, seed_liquidity, user_stake_total, status)
         VALUES ('pool-1', 'race-1', 'win', ?, 100000, 0, 'open')`,
      )
      .run(account.id);
    const purchase = vi.spyOn(SqliteGameStore.prototype, 'purchaseBet').mockReturnValue({
      id: 'bet-1',
      wasDuplicate: false,
      balanceAfter: money(49_900n),
    });
    try {
      const gateway = new SqliteDiscordPurchaseGateway(
        database,
        { now: () => timestamp(now) },
        {
          async isCurrentMember() {
            return true;
          },
        },
      );
      await gateway.purchase({
        discordUserId: 'user-1',
        raceId: 'race-1',
        raceVersion: 3,
        poolType: 'win',
        selectionCode: '1',
        stake: money(100n),
        interactionId: 'interaction-1',
        operationId: 'operation-1',
      });
      const row = database
        .prepare(
          `SELECT payload_json AS payloadJson FROM scheduled_jobs
           WHERE job_type = 'refresh_race_message'`,
        )
        .get() as { payloadJson: string } | undefined;
      expect(row).toBeDefined();
      expect(JSON.parse(row!.payloadJson)).toEqual({ raceId: 'race-1', raceVersion: 3 });
    } finally {
      purchase.mockRestore();
      database.close();
    }
  });

  it('rolls back a purchase when its message refresh cannot be scheduled', async () => {
    const now = 1_800_000_000_000;
    const database = openDatabase(':memory:');
    applyMigrations(database, migrationsDirectory, now);
    const game = new SqliteGameStore(database, () => now);
    game.initializeEconomy([]);
    const user = game.registerUser('user-1', '利用者', true);
    const account = database
      .prepare("SELECT id FROM accounts WHERE owner_key = ? AND account_type = 'user'")
      .get(user.id) as { id: string };
    database
      .prepare(
        `INSERT INTO races
         (id, race_date, name, kind, status, version, distance_m, going,
          scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
          created_at, updated_at)
         VALUES ('race-1', '2026-08-20', '購入更新', 'regular', 'betting_open', 3, 1200, 'firm',
                 ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        BigInt(now + 60_000),
        BigInt(now - 60_000),
        BigInt(now + 30_000),
        BigInt(now - 60_000),
        BigInt(now),
        BigInt(now),
      );
    database
      .prepare(
        `INSERT INTO bet_pools
         (id, race_id, pool_type, account_id, seed_liquidity, user_stake_total, status)
         VALUES ('pool-1', 'race-1', 'win', ?, 100000, 0, 'open')`,
      )
      .run(account.id);
    const refreshAt = nextOddsRefreshAt(now, 30_000);
    database
      .prepare(
        `INSERT INTO scheduled_jobs
         (id, job_type, deduplication_key, payload_json, run_at, status, attempt_count,
          created_at, updated_at)
         VALUES ('conflict', 'refresh_race_message', ?, '{}', ?, 'pending', 0, ?, ?)`,
      )
      .run(
        `refresh-race:race-1:3:${String(refreshAt)}`,
        BigInt(refreshAt + 1),
        BigInt(now),
        BigInt(now),
      );
    const purchase = vi.spyOn(SqliteGameStore.prototype, 'purchaseBet').mockImplementation(() => {
      database.prepare("UPDATE users SET display_name = '変更済み' WHERE id = ?").run(user.id);
      return { id: 'bet-1', wasDuplicate: false, balanceAfter: money(49_900n) };
    });
    try {
      const gateway = new SqliteDiscordPurchaseGateway(
        database,
        { now: () => timestamp(now) },
        {
          async isCurrentMember() {
            return true;
          },
        },
      );
      await expect(
        gateway.purchase({
          discordUserId: 'user-1',
          raceId: 'race-1',
          raceVersion: 3,
          poolType: 'win',
          selectionCode: '1',
          stake: money(100n),
          interactionId: 'interaction-1',
          operationId: 'operation-1',
        }),
      ).rejects.toThrow();
      expect(database.prepare('SELECT display_name FROM users WHERE id = ?').get(user.id)).toEqual({
        display_name: '利用者',
      });
    } finally {
      purchase.mockRestore();
      database.close();
    }
  });
});
