import type { GuildMembership } from '@jcb/application';
import { DEFAULT_GAME_SETTINGS, gameSettingsSchema } from '@jcb/config';
import type { SqliteDatabase } from '@jcb/database';
import { SqliteGameStore, SqliteJobStore } from '@jcb/database';
import type { DiscordPurchaseGateway, PurchasePreview, PurchaseReceipt } from '@jcb/discord';
import { estimatedGrossPayout } from '@jcb/economy';
import { money, timestamp, type Clock, type Money, type PoolType } from '@jcb/domain';

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

  public async preview(input: {
    readonly discordUserId: string;
    readonly raceId: string;
    readonly poolType: PoolType;
    readonly selectionCode: string;
    readonly stake: Money;
  }): Promise<PurchasePreview> {
    if (!(await this.membership.isCurrentMember(input.discordUserId))) {
      throw new Error('Current guild membership is required.');
    }
    const row = this.database
      .prepare(
        `SELECT ab.amount AS balance, bp.seed_liquidity AS seedLiquidity,
                bp.user_stake_total AS userStakeTotal, op.seed_stake AS seedSelectionStake,
                COALESCE(SUM(b.stake), 0) AS userSelectionStake
         FROM users u
         JOIN accounts a ON a.owner_key = u.id AND a.account_type = 'user'
         JOIN account_balances ab ON ab.account_id = a.id
         JOIN bet_pools bp ON bp.race_id = ?
         JOIN odds_probabilities op ON op.race_id = bp.race_id
              AND op.pool_type = bp.pool_type AND op.selection_code = ?
         LEFT JOIN bets b ON b.pool_id = bp.id AND b.selection_code = ?
              AND b.status = 'open'
         WHERE u.discord_user_id = ? AND bp.pool_type = ?
         GROUP BY u.id, bp.id, op.id`,
      )
      .get(
        input.raceId,
        input.selectionCode,
        input.selectionCode,
        input.discordUserId,
        input.poolType,
      ) as
      | {
          balance: bigint;
          seedLiquidity: bigint;
          userStakeTotal: bigint;
          seedSelectionStake: bigint;
          userSelectionStake: bigint;
        }
      | undefined;
    if (row === undefined) throw new Error('User, pool, or selection was not found.');
    if (row.balance < input.stake) throw new Error('Insufficient balance.');
    const poolTotal = money(row.seedLiquidity + row.userStakeTotal);
    const selectionTotal = money(row.seedSelectionStake + row.userSelectionStake);
    const carryover =
      input.poolType === 'trifecta'
        ? ((
            this.database
              .prepare(
                "SELECT amount_projection AS amount FROM trifecta_carryover WHERE id = 'global'",
              )
              .get() as { amount: bigint }
          ).amount ?? 0n)
        : 0n;
    const carryoverBonus =
      input.poolType === 'trifecta'
        ? money((carryover * input.stake) / (row.userSelectionStake + input.stake))
        : money(0n);
    return {
      estimatedBasePayout: estimatedGrossPayout(input.stake, poolTotal, selectionTotal),
      estimatedCarryoverBonus: carryoverBonus,
      balanceAfter: money(row.balance - input.stake),
    };
  }

  public async purchase(input: {
    readonly discordUserId: string;
    readonly raceId: string;
    readonly raceVersion: number;
    readonly poolType: PoolType;
    readonly selectionCode: string;
    readonly stake: Money;
    readonly interactionId: string;
  }): Promise<PurchaseReceipt> {
    const isGuildMember = await this.membership.isCurrentMember(input.discordUserId);
    const user = this.database
      .prepare('SELECT id FROM users WHERE discord_user_id = ?')
      .get(input.discordUserId) as { id: string } | undefined;
    if (user === undefined) throw new Error('User is not registered.');
    const pool = this.database
      .prepare('SELECT id FROM bet_pools WHERE race_id = ? AND pool_type = ?')
      .get(input.raceId, input.poolType) as { id: string } | undefined;
    if (pool === undefined) throw new Error('Bet pool is not open.');
    const purchased = this.gameStore.purchaseBet({
      userId: user.id,
      poolId: pool.id,
      poolType: input.poolType,
      selectionCode: input.selectionCode,
      stake: input.stake,
      interactionId: input.interactionId,
      idempotencyKey: `discord:${input.interactionId}`,
      expectedRaceVersion: input.raceVersion,
      isGuildMember,
      now: this.clock.now(),
    });
    if (!purchased.wasDuplicate) {
      const current = this.clock.now();
      const interval = this.oddsRefreshInterval();
      const refreshAt = nextOddsRefreshAt(current, interval);
      new SqliteJobStore(this.database, cryptoUnit).enqueue({
        jobType: 'refresh_race_message',
        deduplicationKey: `refresh-race:${input.raceId}:${String(input.raceVersion)}:${String(refreshAt)}`,
        payload: { raceId: input.raceId },
        runAt: refreshAt,
      });
    }
    return {
      betId: purchased.id,
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
