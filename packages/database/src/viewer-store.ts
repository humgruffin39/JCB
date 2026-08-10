import type Database from 'better-sqlite3';
import { money, type PoolType, type RaceStatus } from '@jcb/domain';
import { currentOddsTenths, formatOdds } from '@jcb/odds';

interface RaceDetailRow {
  readonly id: string;
  readonly raceDate: string;
  readonly name: string;
  readonly kind: 'regular' | 'midweek' | 'saturday_night';
  readonly status: RaceStatus;
  readonly version: bigint;
  readonly distanceM: bigint;
  readonly surface: 'turf' | 'dirt';
  readonly scheduledAt: bigint;
  readonly bettingClosesAt: bigint;
  readonly viewerOpensAt: bigint;
}

export class SqliteViewerStore {
  public constructor(private readonly database: Database.Database) {}

  public getMe(discordUserId: string): {
    readonly discordUserId: string;
    readonly displayName: string;
    readonly balance: string;
  } {
    const row = this.database
      .prepare(
        `SELECT u.discord_user_id AS discordUserId, u.display_name AS displayName,
                ab.amount AS balance
         FROM users u
         JOIN accounts a ON a.owner_key = u.id AND a.account_type = 'user'
         JOIN account_balances ab ON ab.account_id = a.id
         WHERE u.discord_user_id = ? AND u.status = 'active'`,
      )
      .get(discordUserId) as
      { discordUserId: string; displayName: string; balance: bigint } | undefined;
    if (row === undefined) throw new Error('Registered user not found.');
    return { ...row, balance: row.balance.toString() };
  }

  public getRaceDetail(raceId: string) {
    const race = this.database
      .prepare(
        `SELECT id, race_date AS raceDate, name, kind, status, version,
                distance_m AS distanceM, surface, scheduled_at AS scheduledAt,
                betting_closes_at AS bettingClosesAt, viewer_opens_at AS viewerOpensAt
         FROM races WHERE id = ?`,
      )
      .get(raceId) as RaceDetailRow | undefined;
    if (race === undefined) throw new Error('Race not found.');
    const entries = this.database
      .prepare(
        `SELECT re.horse_number AS horseNumber, re.horse_id AS horseId,
                re.snapshot_name AS name, re.snapshot_running_style AS runningStyle,
                h.coat_color AS coatColor,
                re.condition, op.base_odds AS baseOdds, op.seed_stake AS seedStake,
                bp.seed_liquidity AS seedLiquidity, bp.user_stake_total AS totalUserStake,
                COALESCE(SUM(b.stake), 0) AS userSelectionStake
         FROM race_entries re
         JOIN horses h ON h.id = re.horse_id
         LEFT JOIN odds_probabilities op ON op.race_id = re.race_id
              AND op.pool_type = 'win' AND op.selection_code = CAST(re.horse_number AS TEXT)
         LEFT JOIN bet_pools bp ON bp.race_id = re.race_id AND bp.pool_type = 'win'
         LEFT JOIN bets b ON b.pool_id = bp.id
              AND b.selection_code = CAST(re.horse_number AS TEXT) AND b.status = 'open'
         WHERE re.race_id = ?
         GROUP BY re.id ORDER BY re.horse_number`,
      )
      .all(raceId) as Array<{
      horseNumber: bigint;
      horseId: string;
      name: string;
      runningStyle: 'front_runner' | 'closer';
      coatColor: 'black' | 'chestnut' | 'gray' | 'cream';
      condition: 'terrible' | 'poor' | 'normal' | 'good' | 'excellent';
      baseOdds: number | null;
      seedStake: bigint | null;
      seedLiquidity: bigint | null;
      totalUserStake: bigint | null;
      userSelectionStake: bigint;
    }>;
    const trifectaPool = this.database
      .prepare(
        `SELECT seed_liquidity + user_stake_total AS amount
         FROM bet_pools WHERE race_id = ? AND pool_type = 'trifecta'`,
      )
      .get(raceId) as { amount: bigint } | undefined;
    const carryover = this.database
      .prepare("SELECT amount_projection AS amount FROM trifecta_carryover WHERE id = 'global'")
      .get() as { amount: bigint } | undefined;
    return {
      id: race.id,
      raceDate: race.raceDate,
      name: race.name,
      kind: race.kind,
      status: race.status,
      version: Number(race.version),
      distanceM: Number(race.distanceM),
      surface: race.surface,
      scheduledAt: Number(race.scheduledAt),
      bettingClosesAt: Number(race.bettingClosesAt),
      viewerOpensAt: Number(race.viewerOpensAt),
      entries: entries.map((entry) => ({
        horseNumber: Number(entry.horseNumber),
        horseId: entry.horseId,
        name: entry.name,
        runningStyle: entry.runningStyle,
        coatColor: entry.coatColor,
        condition: entry.condition,
        baseWinOdds: entry.baseOdds === null ? '—' : entry.baseOdds.toFixed(1),
        currentWinOdds:
          entry.seedStake === null || entry.seedLiquidity === null || entry.totalUserStake === null
            ? '—'
            : formatOdds(
                currentOddsTenths(
                  money(entry.seedLiquidity),
                  money(entry.totalUserStake),
                  money(entry.seedStake),
                  money(entry.userSelectionStake),
                ),
              ),
      })),
      trifectaPoolTotal: (trifectaPool?.amount ?? 0n).toString(),
      carryover: (carryover?.amount ?? 0n).toString(),
    };
  }

  public getOdds(
    raceId: string,
    poolType: PoolType,
    selectionCode?: string,
  ): readonly {
    readonly selectionCode: string;
    readonly baseOdds: string;
    readonly currentOdds: string;
  }[] {
    if (poolType === 'trifecta' && selectionCode === undefined) {
      throw new Error('A trifecta selection is required; the 336-combination list is not exposed.');
    }
    const rows = this.database
      .prepare(
        `SELECT op.selection_code AS selectionCode, op.base_odds AS baseOdds,
                op.seed_stake AS seedStake, bp.seed_liquidity AS seedLiquidity,
                bp.user_stake_total AS totalUserStake,
                COALESCE(SUM(b.stake), 0) AS userSelectionStake
         FROM odds_probabilities op
         JOIN bet_pools bp ON bp.race_id = op.race_id AND bp.pool_type = op.pool_type
         LEFT JOIN bets b ON b.pool_id = bp.id AND b.selection_code = op.selection_code
              AND b.status = 'open'
         WHERE op.race_id = ? AND op.pool_type = ?
           AND (? IS NULL OR op.selection_code = ?)
         GROUP BY op.id ORDER BY op.selection_code`,
      )
      .all(raceId, poolType, selectionCode ?? null, selectionCode ?? null) as Array<{
      selectionCode: string;
      baseOdds: number;
      seedStake: bigint;
      seedLiquidity: bigint;
      totalUserStake: bigint;
      userSelectionStake: bigint;
    }>;
    return rows.map((row) => ({
      selectionCode: row.selectionCode,
      baseOdds: row.baseOdds.toFixed(1),
      currentOdds: formatOdds(
        currentOddsTenths(
          money(row.seedLiquidity),
          money(row.totalUserStake),
          money(row.seedStake),
          money(row.userSelectionStake),
        ),
      ),
    }));
  }

  public getMyBets(
    raceId: string,
    discordUserId: string,
  ): readonly {
    readonly id: string;
    readonly poolType: PoolType;
    readonly selectionCode: string;
    readonly stake: string;
    readonly status: string;
    readonly payout: string;
    readonly createdAt: number;
  }[] {
    const rows = this.database
      .prepare(
        `SELECT b.id, bp.pool_type AS poolType, b.selection_code AS selectionCode,
                b.stake, b.status, b.payout, b.created_at AS createdAt
         FROM bets b
         JOIN bet_pools bp ON bp.id = b.pool_id
         JOIN users u ON u.id = b.user_id
         WHERE bp.race_id = ? AND u.discord_user_id = ?
         ORDER BY b.created_at, b.id`,
      )
      .all(raceId, discordUserId) as Array<{
      id: string;
      poolType: PoolType;
      selectionCode: string;
      stake: bigint;
      status: string;
      payout: bigint;
      createdAt: bigint;
    }>;
    return rows.map((row) => ({
      ...row,
      stake: row.stake.toString(),
      payout: row.payout.toString(),
      createdAt: Number(row.createdAt),
    }));
  }

  public getResult(raceId: string) {
    const race = this.database.prepare('SELECT status FROM races WHERE id = ?').get(raceId) as
      { status: RaceStatus } | undefined;
    if (race === undefined) throw new Error('Race not found.');
    if (!['finished', 'settling', 'settled'].includes(race.status)) {
      throw new Error('RACE_NOT_FINISHED');
    }
    const rows = this.database
      .prepare(
        `SELECT horse_number AS horseNumber, finish_position AS position,
                finish_time_ms AS finishTimeMs
         FROM race_entries WHERE race_id = ? ORDER BY finish_position`,
      )
      .all(raceId) as Array<{
      horseNumber: bigint;
      position: bigint | null;
      finishTimeMs: bigint | null;
    }>;
    if (
      rows.length !== 8 ||
      rows.some((row) => row.position === null || row.finishTimeMs === null)
    ) {
      throw new Error('RACE_NOT_FINISHED');
    }
    return {
      finishOrder: rows.map((row) => ({
        horseNumber: Number(row.horseNumber),
        position: Number(row.position),
        finishTimeMs: Number(row.finishTimeMs),
      })),
    };
  }

  public getEdgeTokenExpiry(raceId: string): number {
    const row = this.database
      .prepare(
        `SELECT scheduled_at + COALESCE(timeline_duration_ms, 0) + ? AS expiry
         FROM races WHERE id = ?`,
      )
      .get(24n * 60n * 60n * 1000n, raceId) as { expiry: bigint } | undefined;
    if (row === undefined) throw new Error('Race not found.');
    return Number(row.expiry);
  }
}
