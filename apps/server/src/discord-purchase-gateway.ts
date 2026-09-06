import type { GuildMembership } from '@jcb/application';
import { DEFAULT_GAME_SETTINGS, gameSettingsSchema } from '@jcb/config';
import type { SqliteDatabase } from '@jcb/database';
import { raceBetLimitFor, SqliteGameStore, SqliteJobStore } from '@jcb/database';
import type { DiscordPurchaseGateway, PurchasePreview, PurchaseReceipt } from '@jcb/discord';
import { estimatedGrossPayout } from '@jcb/economy';
import {
  money,
  POOL_TYPE_DEFINITIONS,
  timestamp,
  type Clock,
  type Money,
  type PoolType,
  type RaceKind,
} from '@jcb/domain';

export class SqliteDiscordPurchaseGateway implements DiscordPurchaseGateway {
  private readonly gameStore: SqliteGameStore;

  public constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: Clock,
    private readonly membership: GuildMembership,
  ) {
    this.gameStore = new SqliteGameStore(database, () => clock.now());
  }

  public async currentRaceVersion(raceId: string): Promise<number> {
    return this.gameStore.getRace(raceId).version;
  }

  public async raceBetLimit(raceId: string): Promise<Money> {
    const race = this.database
      .prepare(
        `SELECT kind, simulation_config_json AS simulationConfigJson FROM races WHERE id = ?`,
      )
      .get(raceId) as { kind: RaceKind; simulationConfigJson: string } | undefined;
    if (race === undefined) throw new Error('Race not found.');
    return money(BigInt(raceBetLimitFor(race.simulationConfigJson, race.kind)));
  }

  public async preview(input: {
    readonly discordUserId: string;
    readonly raceId: string;
    readonly poolType: PoolType;
    readonly selectionCodes: readonly string[];
    readonly stakePerPoint: Money;
  }): Promise<PurchasePreview> {
    if (!(await this.membership.isCurrentMember(input.discordUserId))) {
      throw new Error('Current guild membership is required.');
    }
    const points = input.selectionCodes.length;
    if (points === 0) throw new Error('Selection is missing.');
    const totalStake = money(input.stakePerPoint * BigInt(points));
    const account = this.database
      .prepare(
        `SELECT ab.amount AS balance FROM users u
         JOIN accounts a ON a.owner_key = u.id AND a.account_type = 'user'
         JOIN account_balances ab ON ab.account_id = a.id
         WHERE u.discord_user_id = ?`,
      )
      .get(input.discordUserId) as { balance: bigint } | undefined;
    const pool = this.database
      .prepare(
        `SELECT id, seed_liquidity AS seedLiquidity, user_stake_total AS userStakeTotal
         FROM bet_pools WHERE race_id = ? AND pool_type = ?`,
      )
      .get(input.raceId, input.poolType) as
      { id: string; seedLiquidity: bigint; userStakeTotal: bigint } | undefined;
    if (account === undefined || pool === undefined) {
      throw new Error('User, pool, or selection was not found.');
    }
    if (account.balance < totalStake) throw new Error('Insufficient balance.');
    const stakes = this.selectionStakes(
      input.raceId,
      input.poolType,
      pool.id,
      input.selectionCodes,
    );
    const carryover =
      input.poolType === 'trifecta'
        ? ((
            this.database
              .prepare(
                "SELECT amount_projection AS amount FROM trifecta_carryover WHERE id = 'global'",
              )
              .get() as { amount: bigint } | undefined
          )?.amount ?? 0n)
        : 0n;
    // Every point of a formation enters the pool, so each one is quoted against
    // the pool the whole purchase leaves behind rather than against itself alone.
    const poolAfterOtherPoints = money(
      pool.seedLiquidity + pool.userStakeTotal + totalStake - input.stakePerPoint,
    );
    const payouts = input.selectionCodes.map((code) => {
      const selection = stakes.get(code);
      if (selection === undefined) throw new Error('User, pool, or selection was not found.');
      const base = estimatedGrossPayout(
        input.stakePerPoint,
        poolAfterOtherPoints,
        money(selection.seedStake + selection.userStake),
        POOL_TYPE_DEFINITIONS[input.poolType].winningSelectionCount,
      );
      const bonus =
        carryover > 0n
          ? (carryover * input.stakePerPoint) / (selection.userStake + input.stakePerPoint)
          : 0n;
      return base + bonus;
    });
    return {
      points,
      totalStake,
      minimumPayout: money(payouts.reduce((low, value) => (value < low ? value : low))),
      maximumPayout: money(payouts.reduce((high, value) => (value > high ? value : high))),
      includesCarryover: carryover > 0n,
      balanceAfter: money(account.balance - totalStake),
    };
  }

  private selectionStakes(
    raceId: string,
    poolType: PoolType,
    poolId: string,
    selectionCodes: readonly string[],
  ): ReadonlyMap<string, { readonly seedStake: bigint; readonly userStake: bigint }> {
    const placeholders = selectionCodes.map(() => '?').join(',');
    const rows = this.database
      .prepare(
        `SELECT op.selection_code AS selectionCode, op.seed_stake AS seedStake,
                COALESCE(SUM(b.stake), 0) AS userStake
         FROM odds_probabilities op
         LEFT JOIN bets b ON b.pool_id = ? AND b.selection_code = op.selection_code
              AND b.status = 'open'
         WHERE op.race_id = ? AND op.pool_type = ?
           AND op.selection_code IN (${placeholders})
         GROUP BY op.id`,
      )
      .all(poolId, raceId, poolType, ...selectionCodes) as Array<{
      selectionCode: string;
      seedStake: bigint;
      userStake: bigint;
    }>;
    return new Map(
      rows.map((row) => [
        row.selectionCode,
        { seedStake: row.seedStake, userStake: row.userStake },
      ]),
    );
  }

  public async purchase(input: {
    readonly discordUserId: string;
    readonly raceId: string;
    readonly raceVersion: number;
    readonly poolType: PoolType;
    readonly selectionCodes: readonly string[];
    readonly stakePerPoint: Money;
    readonly interactionId: string;
    readonly operationId: string;
  }): Promise<PurchaseReceipt> {
    if (input.selectionCodes.length === 0) throw new Error('Selection is missing.');
    const isGuildMember = await this.membership.isCurrentMember(input.discordUserId);
    const user = this.database
      .prepare('SELECT id FROM users WHERE discord_user_id = ?')
      .get(input.discordUserId) as { id: string } | undefined;
    if (user === undefined) throw new Error('User is not registered.');
    const pool = this.database
      .prepare('SELECT id FROM bet_pools WHERE race_id = ? AND pool_type = ?')
      .get(input.raceId, input.poolType) as { id: string } | undefined;
    if (pool === undefined) throw new Error('Bet pool is not open.');
    // One transaction for the whole formation: a partially bought ticket set is
    // worse than none, the per-race cap has to see every point at once, and the
    // odds refresh still has to be scheduled or the purchase undone.
    const purchased = this.database
      .transaction(() => {
        const result = this.gameStore.purchaseBets(
          input.selectionCodes.map((selectionCode) => ({
            userId: user.id,
            poolId: pool.id,
            poolType: input.poolType,
            selectionCode,
            stake: input.stakePerPoint,
            interactionId: input.interactionId,
            idempotencyKey: `discord-session:${input.operationId}:${selectionCode}`,
            expectedRaceVersion: input.raceVersion,
            isGuildMember,
            now: this.clock.now(),
          })),
        );
        if (!result.wasDuplicate) {
          const refreshAt = nextOddsRefreshAt(this.clock.now(), this.oddsRefreshInterval());
          new SqliteJobStore(this.database, cryptoUnit, () => this.clock.now()).enqueue({
            jobType: 'refresh_race_message',
            deduplicationKey: `refresh-race:${input.raceId}:${String(input.raceVersion)}:${String(refreshAt)}`,
            payload: { raceId: input.raceId, raceVersion: input.raceVersion },
            runAt: refreshAt,
          });
        }
        return result;
      })
      .immediate();
    const first = purchased.bets[0];
    if (first === undefined) throw new Error('Purchase produced no bet.');
    return {
      betId: first.id,
      points: purchased.bets.length,
      totalStake: money(input.stakePerPoint * BigInt(purchased.bets.length)),
      balanceAfter: purchased.balanceAfter,
      wasDuplicate: purchased.wasDuplicate,
    };
  }

  public async raceHorses(
    raceId: string,
  ): Promise<readonly { readonly number: number; readonly name: string }[]> {
    const rows = this.database
      .prepare(
        `SELECT horse_number AS number, snapshot_name AS name
         FROM race_entries WHERE race_id = ? ORDER BY horse_number`,
      )
      .all(raceId) as Array<{ number: bigint; name: string }>;
    return rows.map((row) => ({ number: Number(row.number), name: row.name }));
  }

  private oddsRefreshInterval(): number {
    const row = this.database
      .prepare("SELECT value_json AS valueJson FROM app_settings WHERE key = 'game_settings'")
      .get() as { valueJson: string } | undefined;
    if (row === undefined) return DEFAULT_GAME_SETTINGS.discordOddsUpdateMilliseconds;
    const parsed = gameSettingsSchema.safeParse(JSON.parse(row.valueJson));
    return parsed.success
      ? parsed.data.discordOddsUpdateMilliseconds
      : DEFAULT_GAME_SETTINGS.discordOddsUpdateMilliseconds;
  }
}

export function nextOddsRefreshAt(current: number, interval: number): ReturnType<typeof timestamp> {
  if (!Number.isSafeInteger(interval) || interval <= 0) {
    throw new Error('Odds refresh interval must be a positive integer.');
  }
  return timestamp((Math.floor(current / interval) + 1) * interval);
}

function cryptoUnit(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return (values[0] ?? 0) / 4_294_967_296;
}
