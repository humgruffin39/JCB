import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './connection.js';
import { SqliteGameStore } from './game-store.js';
import { applyMigrations } from './migrations.js';
import { SqliteRankingStore } from './ranking-store.js';

describe('ranking calculation', () => {
  it('uses a constant number of prepared queries as the user count grows', () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      1,
    );
    const game = new SqliteGameStore(database, () => 1);
    game.initializeEconomy([]);
    for (let index = 0; index < 50; index += 1) {
      game.registerUser(`user-${String(index)}`, `利用者${String(index)}`, true);
    }
    const prepare = vi.spyOn(database, 'prepare');
    const snapshot = new SqliteRankingStore(database, () => 2).calculateAndSave();
    expect(snapshot.users).toHaveLength(50);
    expect(prepare).toHaveBeenCalledTimes(6);
    database.close();
  });

  it('does not count open bets until they are settled', () => {
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      1,
    );
    const game = new SqliteGameStore(database, () => 1);
    game.initializeEconomy([]);
    const user = game.registerUser('ranking-user', 'ランキング利用者', true);
    const raceId = 'ranking-race';
    database
      .prepare(
        `INSERT INTO races
         (id, race_date, name, kind, status, version, distance_m, going,
          scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
          created_at, updated_at)
         VALUES (?, '2026-08-20', 'ランキング試験', 'regular', 'settled', 1, 1200, 'firm',
                 1000, 100, 200, 300, 1, 1)`,
      )
      .run(raceId);
    const poolAccountId = game.ledgerStore().createAccount({
      ownerType: 'race',
      ownerKey: raceId,
      accountType: 'race_win_pool',
    });
    database
      .prepare(
        `INSERT INTO bet_pools
         (id, race_id, pool_type, account_id, seed_liquidity, user_stake_total, status)
         VALUES ('ranking-pool', ?, 'win', ?, 1000, 500, 'settled')`,
      )
      .run(raceId, poolAccountId);
    database
      .prepare(
        `INSERT INTO bets
         (id, pool_id, user_id, selection_code, stake, status, payout,
          interaction_id, idempotency_key, created_at)
         VALUES ('ranking-bet', 'ranking-pool', ?, '1', 500, 'open', 0,
                 'ranking-interaction', 'ranking-idempotency', 1)`,
      )
      .run(user.id);

    const ranking = new SqliteRankingStore(database, () => 2);
    expect(ranking.calculateAndSave().users[0]).toMatchObject({
      discordUserId: 'ranking-user',
      lifetimeProfit: '0',
      totalPayout: '0',
    });

    database
      .prepare(
        "UPDATE bets SET status = 'won', payout = 900, settled_at = 3 WHERE id = 'ranking-bet'",
      )
      .run();
    expect(ranking.calculateAndSave().users[0]).toMatchObject({
      lifetimeProfit: '400',
      totalPayout: '900',
    });
    database.close();
  });
});
