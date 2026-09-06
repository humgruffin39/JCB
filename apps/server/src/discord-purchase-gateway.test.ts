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
    const purchase = vi.spyOn(SqliteGameStore.prototype, 'purchaseBets').mockReturnValue({
      bets: [{ id: 'bet-1', wasDuplicate: false, balanceAfter: money(49_900n) }],
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
        selectionCodes: ['1'],
        stakePerPoint: money(100n),
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

  it('prices every point against the pool the whole formation leaves behind', async () => {
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
         VALUES ('race-1', '2026-08-20', '見込み', 'regular', 'betting_open', 3, 1200, 'firm',
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
         VALUES ('pool-1', 'race-1', 'trifecta', ?, 30000, 0, 'open')`,
      )
      .run(account.id);
    const odds = database.prepare(
      `INSERT INTO odds_probabilities
       (id, race_id, pool_type, selection_code, model_probability, base_odds, seed_stake, created_at)
       VALUES (?, 'race-1', 'trifecta', ?, 0.5, 1.0, ?, ?)`,
    );
    odds.run('odds-a', '1-2-3', 10_000n, BigInt(now));
    odds.run('odds-b', '1-3-2', 20_000n, BigInt(now));

    const gateway = new SqliteDiscordPurchaseGateway(
      database,
      { now: () => timestamp(now) },
      {
        async isCurrentMember() {
          return true;
        },
      },
    );
    const preview = await gateway.preview({
      discordUserId: 'user-1',
      raceId: 'race-1',
      poolType: 'trifecta',
      selectionCodes: ['1-2-3', '1-3-2'],
      stakePerPoint: money(1_000n),
    });

    expect(preview.points).toBe(2);
    expect(preview.totalStake).toBe(2_000n);
    expect(preview.balanceAfter).toBe(48_000n);
    // Both points are in the pool either way, so each is quoted against 32,000.
    expect(preview.maximumPayout).toBe((32_000n * 1_000n) / 11_000n);
    expect(preview.minimumPayout).toBe((32_000n * 1_000n) / 21_000n);
    expect(preview.includesCarryover).toBe(false);
    database.close();
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
    const purchase = vi.spyOn(SqliteGameStore.prototype, 'purchaseBets').mockImplementation(() => {
      database.prepare("UPDATE users SET display_name = '変更済み' WHERE id = ?").run(user.id);
      return {
        bets: [{ id: 'bet-1', wasDuplicate: false, balanceAfter: money(49_900n) }],
        wasDuplicate: false,
        balanceAfter: money(49_900n),
      };
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
          selectionCodes: ['1'],
          stakePerPoint: money(100n),
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
