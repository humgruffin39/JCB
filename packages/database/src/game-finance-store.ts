import type Database from 'better-sqlite3';
import {
  DomainError,
  identifier,
  money,
  timestamp,
  transitionRace,
  type AccountId,
  type Money,
  type PoolType,
  type RaceKind,
  type RaceStatus,
  type Timestamp,
} from '@jcb/domain';
import type { RacePoolPreparation } from '@jcb/application';
import { calculateRelief, reliefIdempotencyKey, transfer, validatePurchase } from '@jcb/economy';
import {
  planAdaptiveSeedLiquidity,
  type SeedLiquidity,
  type SeedPositionAllocation,
} from '@jcb/odds';
import { ulid } from 'ulid';
import {
  DEFAULT_RACE_BET_LIMITS,
  DEFAULT_SEED_LIQUIDITY_CLAMP,
  type SeedClamp,
} from './game-store-types.js';
import type { SqliteLedgerStore } from './ledger-store.js';

export interface PurchaseBetInput {
  readonly userId: string;
  readonly poolId: string;
  readonly poolType: PoolType;
  readonly selectionCode: string;
  readonly stake: Money;
  readonly interactionId: string;
  readonly idempotencyKey: string;
  readonly expectedRaceVersion: number;
  readonly isGuildMember: boolean;
  readonly now: Timestamp;
}

export interface PurchasedBet {
  readonly id: string;
  readonly wasDuplicate: boolean;
  readonly balanceAfter: Money;
}

export interface OpenBettingPoolsInput {
  readonly raceId: string;
  readonly pools?: readonly RacePoolPreparation[];
  readonly winLiquidity?: Money;
  readonly trifectaLiquidity?: Money;
  readonly winPositions?: readonly SeedPositionAllocation[];
  readonly trifectaPositions?: readonly SeedPositionAllocation[];
}

export class SqliteGameFinanceStore {
  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
    private readonly ledger: SqliteLedgerStore,
  ) {}

  public openBettingPools(input: OpenBettingPoolsInput): void {
    const run = this.database.transaction(() => {
      const race = this.database
        .prepare('SELECT status, version FROM races WHERE id = ?')
        .get(input.raceId) as { status: RaceStatus; version: bigint } | undefined;
      if (race === undefined) throw new Error('Race not found.');
      transitionRace(race.status, 'betting_open');
      const centralBank = this.findSystemAccount('central_bank');
      const pools = input.pools ?? legacyPoolPreparations(input);
      if (pools.length === 0) throw new Error('Betting pools are missing.');
      const createdPools = pools.map((pool) =>
        this.createPool(input.raceId, pool.poolType, pool.liquidity, pool.positions),
      );
      const totalLiquidity = pools.reduce((sum, pool) => sum + pool.liquidity, 0n);
      this.ledger.post({
        kind: 'seed_liquidity',
        referenceType: 'race',
        referenceId: input.raceId,
        idempotencyKey: `seed-liquidity:${input.raceId}:${String(race.version)}`,
        description: 'Fund race pools with central-bank seed liquidity',
        entries: [
          {
            accountId: centralBank,
            amount: money(-totalLiquidity),
          },
          ...createdPools.map((pool, index) => ({
            accountId: pool.accountId,
            amount: pools[index]!.liquidity,
          })),
        ],
      });
      const update = this.database
        .prepare(
          `UPDATE races SET status = 'betting_open', updated_at = ?
           WHERE id = ? AND status = 'simulating'`,
        )
        .run(BigInt(this.now()), input.raceId);
      if (update.changes !== 1) throw new Error('Race changed while opening betting pools.');
    });
    run.immediate();
  }

  public purchaseBet(input: PurchaseBetInput): PurchasedBet {
    const run = this.database.transaction((): PurchasedBet => {
      const duplicate = this.database
        .prepare(
          `SELECT id, pool_id AS poolId, user_id AS userId, selection_code AS selectionCode,
                  stake, balance_after AS balanceAfter
           FROM bets WHERE idempotency_key = ?`,
        )
        .get(input.idempotencyKey) as
        | {
            id: string;
            poolId: string;
            userId: string;
            selectionCode: string;
            stake: bigint;
            balanceAfter: bigint | null;
          }
        | undefined;
      const accountId = this.findUserAccount(input.userId);
      if (duplicate !== undefined) {
        if (
          duplicate.poolId !== input.poolId ||
          duplicate.userId !== input.userId ||
          duplicate.selectionCode !== input.selectionCode ||
          duplicate.stake !== input.stake
        ) {
          throw new DomainError(
            'DUPLICATE_OPERATION',
            'Idempotency key was already used for a different bet purchase.',
          );
        }
        return {
          id: duplicate.id,
          wasDuplicate: true,
          balanceAfter:
            duplicate.balanceAfter === null
              ? this.ledger.balance(accountId)
              : money(duplicate.balanceAfter),
        };
      }
      const pool = this.database
        .prepare(
          `SELECT bp.id, bp.pool_type AS poolType, bp.account_id AS accountId,
                  r.id AS raceId, r.kind, r.status, r.version,
                  r.betting_closes_at AS bettingClosesAt,
                  r.simulation_config_json AS simulationConfigJson
           FROM bet_pools bp JOIN races r ON r.id = bp.race_id
           WHERE bp.id = ?`,
        )
        .get(input.poolId) as
        | {
            id: string;
            poolType: PoolType;
            accountId: string;
            raceId: string;
            kind: RaceKind;
            status: RaceStatus;
            version: bigint;
            bettingClosesAt: bigint;
            simulationConfigJson: string;
          }
        | undefined;
      if (pool === undefined || pool.poolType !== input.poolType)
        throw new Error('Pool not found.');
      const user = this.database
        .prepare('SELECT status FROM users WHERE id = ?')
        .get(input.userId) as { status: string } | undefined;
      const userRaceStake = (
        this.database
          .prepare(
            `SELECT COALESCE(SUM(b.stake), 0) AS amount
             FROM bets b JOIN bet_pools bp ON bp.id = b.pool_id
             WHERE b.user_id = ? AND bp.race_id = ? AND b.status <> 'refunded'`,
          )
          .get(input.userId, pool.raceId) as { amount: bigint }
      ).amount;
      validatePurchase({
        isUserActive: user?.status === 'active',
        isGuildMember: input.isGuildMember,
        raceStatus: pool.status,
        now: input.now,
        bettingClosesAt: timestamp(Number(pool.bettingClosesAt)),
        expectedRaceVersion: input.expectedRaceVersion,
        currentRaceVersion: Number(pool.version),
        stake: input.stake,
        balance: this.ledger.balance(accountId),
        userRaceStake: money(userRaceStake),
        raceKind: pool.kind,
        raceBetLimit: money(
          BigInt(parseRaceFinancialSettings(pool.simulationConfigJson, pool.kind).raceBetLimit),
        ),
        poolType: input.poolType,
        selectionCode: input.selectionCode,
      });
      this.validateSelection(pool.raceId, input.poolType, input.selectionCode);
      const betId = ulid();
      this.database
        .prepare(
          `INSERT INTO bets
           (id, pool_id, user_id, selection_code, stake, status, payout, interaction_id,
            idempotency_key, created_at)
           VALUES (?, ?, ?, ?, ?, 'open', 0, ?, ?, ?)`,
        )
        .run(
          betId,
          input.poolId,
          input.userId,
          input.selectionCode,
          input.stake,
          input.interactionId,
          input.idempotencyKey,
          BigInt(input.now),
        );
      this.ledger.post({
        kind: 'bet_purchase',
        referenceType: 'bet',
        referenceId: betId,
        idempotencyKey: `ledger:${input.idempotencyKey}`,
        description: `${input.poolType} bet purchase`,
        entries: transfer(accountId, identifier(pool.accountId), input.stake),
      });
      this.database
        .prepare('UPDATE bet_pools SET user_stake_total = user_stake_total + ? WHERE id = ?')
        .run(input.stake, input.poolId);
      const balanceAfter = this.ledger.balance(accountId);
      this.database
        .prepare('UPDATE bets SET balance_after = ? WHERE id = ?')
        .run(balanceAfter, betId);
      return { id: betId, wasDuplicate: false, balanceAfter };
    });
    return run.immediate();
  }

  public grantDailyRelief(jstDate: string): number {
    const run = this.database.transaction(() => {
      const centralBank = this.findSystemAccount('central_bank');
      const users = this.database
        .prepare(
          `SELECT u.id AS userId, a.id AS accountId, ab.amount
           FROM users u
           JOIN accounts a ON a.owner_key = u.id AND a.account_type = 'user'
           JOIN account_balances ab ON ab.account_id = a.id
           WHERE u.status = 'active' AND ab.amount < 5000
           ORDER BY u.id`,
        )
        .all() as Array<{ userId: string; accountId: string; amount: bigint }>;
      let grants = 0;
      for (const user of users) {
        const relief = calculateRelief(money(user.amount));
        if (relief <= 0n) continue;
        const result = this.ledger.post({
          kind: 'relief',
          referenceType: 'user',
          referenceId: user.userId,
          idempotencyKey: reliefIdempotencyKey(jstDate, user.userId),
          description: `Daily relief for ${jstDate}`,
          entries: transfer(centralBank, identifier(user.accountId), relief),
        });
        if (!result.wasDuplicate) grants += 1;
      }
      return grants;
    });
    return run.immediate();
  }

  public planSeedLiquidity(raceId: string): {
    readonly liquidity: SeedLiquidity;
    readonly diagnostics: Readonly<Record<string, number | string | null>>;
  } {
    const race = this.database
      .prepare(
        `SELECT kind, scheduled_at AS scheduledAt,
                simulation_config_json AS simulationConfigJson
         FROM races WHERE id = ?`,
      )
      .get(raceId) as
      { kind: RaceKind; scheduledAt: bigint; simulationConfigJson: string } | undefined;
    if (race === undefined) throw new Error('Race not found.');
    const recentRows = this.database
      .prepare(
        `SELECT poolType, amount FROM (
           SELECT bp.pool_type AS poolType, bp.user_stake_total AS amount,
                  ROW_NUMBER() OVER (
                    PARTITION BY bp.pool_type ORDER BY r.scheduled_at DESC
                  ) AS recencyRank
           FROM bet_pools bp JOIN races r ON r.id = bp.race_id
           WHERE r.kind = ? AND r.scheduled_at < ?
             AND r.status IN ('finished', 'settling', 'settled')
             AND bp.pool_type IN ('win', 'trifecta')
         ) WHERE recencyRank <= 14
         ORDER BY poolType, recencyRank`,
      )
      .all(race.kind, race.scheduledAt) as Array<{ poolType: PoolType; amount: bigint }>;
    const recentTotals = (poolType: PoolType): Money[] =>
      recentRows.filter((row) => row.poolType === poolType).map((row) => money(row.amount));
    const financial = parseRaceFinancialSettings(race.simulationConfigJson, race.kind);
    const plan = planAdaptiveSeedLiquidity(
      race.kind,
      recentTotals('win'),
      recentTotals('trifecta'),
      {
        winMinimum: money(BigInt(financial.seedLiquidityClamp.winMinimum)),
        winMaximum: money(BigInt(financial.seedLiquidityClamp.winMaximum)),
        trifectaMinimum: money(BigInt(financial.seedLiquidityClamp.trifectaMinimum)),
        trifectaMaximum: money(BigInt(financial.seedLiquidityClamp.trifectaMaximum)),
      },
    );
    const diagnostics = {
      sampleCount: plan.sampleCount,
      winMedian: plan.winMedian?.toString() ?? null,
      trifectaMedian: plan.trifectaMedian?.toString() ?? null,
      automaticWin: plan.automatic.win.toString(),
      automaticTrifecta: plan.automatic.trifecta.toString(),
      appliedWin: plan.applied.win.toString(),
      appliedTrifecta: plan.applied.trifecta.toString(),
    };
    this.database
      .prepare(
        `UPDATE races SET seed_liquidity_diagnostics_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(diagnostics), BigInt(this.now()), raceId);
    return { liquidity: plan.applied, diagnostics };
  }

  private createPool(
    raceId: string,
    poolType: PoolType,
    liquidity: Money,
    positions: readonly SeedPositionAllocation[],
  ): { readonly id: string; readonly accountId: AccountId } {
    if (positions.reduce((sum, position) => sum + position.stake, 0n) !== liquidity) {
      throw new Error('Seed positions do not sum to liquidity.');
    }
    const accountId = this.ledger.createAccount({
      ownerType: 'race',
      ownerKey: raceId,
      accountType: racePoolAccountType(poolType),
    });
    const poolId = ulid();
    this.database
      .prepare(
        `INSERT INTO bet_pools
         (id, race_id, pool_type, account_id, seed_liquidity, user_stake_total, status)
         VALUES (?, ?, ?, ?, ?, 0, 'open')`,
      )
      .run(poolId, raceId, poolType, accountId, liquidity);
    const insertPosition = this.database.prepare(
      `INSERT INTO seed_positions
       (id, pool_id, selection_code, stake, created_at) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const position of positions) {
      insertPosition.run(
        ulid(),
        poolId,
        position.selectionCode,
        position.stake,
        BigInt(this.now()),
      );
    }
    return { id: poolId, accountId };
  }

  private validateSelection(raceId: string, poolType: PoolType, selectionCode: string): void {
    const exists = this.database
      .prepare(
        `SELECT 1 FROM odds_probabilities
         WHERE race_id = ? AND pool_type = ? AND selection_code = ?`,
      )
      .get(raceId, poolType, selectionCode);
    if (exists === undefined) throw new DomainError('INVALID_SELECTION', 'Selection is invalid.');
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

function racePoolAccountType(poolType: PoolType): string {
  return {
    win: 'race_win_pool',
    place: 'race_place_pool',
    quinella: 'race_quinella_pool',
    exacta: 'race_exacta_pool',
    wide: 'race_wide_pool',
    trio: 'race_trio_pool',
    trifecta: 'race_trifecta_pool',
  }[poolType];
}

function legacyPoolPreparations(input: OpenBettingPoolsInput): readonly RacePoolPreparation[] {
  if (
    input.winLiquidity === undefined ||
    input.trifectaLiquidity === undefined ||
    input.winPositions === undefined ||
    input.trifectaPositions === undefined
  ) {
    throw new Error('Legacy betting pool inputs are incomplete.');
  }
  return [
    {
      poolType: 'win',
      liquidity: input.winLiquidity,
      positions: input.winPositions,
    },
    {
      poolType: 'trifecta',
      liquidity: input.trifectaLiquidity,
      positions: input.trifectaPositions,
    },
  ];
}

function parseRaceFinancialSettings(
  valueJson: string,
  raceKind: RaceKind,
): { readonly raceBetLimit: number; readonly seedLiquidityClamp: SeedClamp } {
  const parsed = JSON.parse(valueJson) as {
    readonly raceBetLimits?: Partial<Record<RaceKind, unknown>>;
    readonly seedLiquidityClamp?: {
      readonly regular?: Partial<Record<keyof SeedClamp, unknown>>;
      readonly special?: Partial<Record<keyof SeedClamp, unknown>>;
    };
  };
  const defaultClamp =
    raceKind === 'regular'
      ? DEFAULT_SEED_LIQUIDITY_CLAMP.regular
      : DEFAULT_SEED_LIQUIDITY_CLAMP.special;
  const configuredClamp =
    raceKind === 'regular'
      ? parsed.seedLiquidityClamp?.regular
      : parsed.seedLiquidityClamp?.special;
  const numeric = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  return {
    raceBetLimit: numeric(parsed.raceBetLimits?.[raceKind], DEFAULT_RACE_BET_LIMITS[raceKind]),
    seedLiquidityClamp: {
      winMinimum: numeric(configuredClamp?.winMinimum, defaultClamp.winMinimum),
      winMaximum: numeric(configuredClamp?.winMaximum, defaultClamp.winMaximum),
      trifectaMinimum: numeric(configuredClamp?.trifectaMinimum, defaultClamp.trifectaMinimum),
      trifectaMaximum: numeric(configuredClamp?.trifectaMaximum, defaultClamp.trifectaMaximum),
    },
  };
}
