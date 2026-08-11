import type Database from 'better-sqlite3';
import {
  DomainError,
  identifier,
  money,
  raceKindForJstDate,
  timestamp,
  transitionRace,
  validateHorseSnapshot,
  type AccountId,
  type Condition,
  type HorseCoatColor,
  type HorseSnapshot,
  type RaceEntry,
  type RaceKind,
  type RaceStatus,
  type Timestamp,
} from '@jcb/domain';
import { transfer } from '@jcb/economy';
import { hashSimulationInput } from '@jcb/simulation';
import { ulid } from 'ulid';
import {
  SqliteGameFinanceStore,
  type OpenBettingPoolsInput,
  type PurchaseBetInput,
  type PurchasedBet,
} from './game-finance-store.js';
import { SqliteLedgerStore } from './ledger-store.js';

export type { PurchaseBetInput, PurchasedBet } from './game-finance-store.js';

export interface HorseWrite extends Omit<HorseSnapshot, 'horseId'> {
  readonly status: 'active' | 'resting' | 'retired';
  readonly coatColor?: HorseCoatColor | undefined;
}

export interface HorseRecord extends Omit<HorseWrite, 'coatColor'> {
  readonly id: string;
  readonly coatColor: HorseCoatColor;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly retiredAt?: Timestamp;
}

export interface RaceEntryDraftInput {
  readonly horseId: string;
  readonly horseNumber: number;
}

export interface RaceDraftInput {
  readonly raceDate: string;
  readonly name: string;
  readonly kind?: RaceKind;
  readonly distanceM: number;
  readonly surface: 'turf' | 'dirt';
  readonly scheduledAt: Timestamp;
  readonly bettingOpensAt: Timestamp;
  readonly bettingClosesAt: Timestamp;
  readonly viewerOpensAt: Timestamp;
  readonly entries: readonly RaceEntryDraftInput[];
}

export type RaceDraftPatch = Partial<RaceDraftInput>;

export interface RaceRecord {
  readonly id: string;
  readonly raceDate: string;
  readonly name: string;
  readonly kind: RaceKind;
  readonly status: RaceStatus;
  readonly version: number;
  readonly distanceM: number;
  readonly surface: 'turf' | 'dirt';
  readonly scheduledAt: Timestamp;
  readonly bettingOpensAt: Timestamp;
  readonly bettingClosesAt: Timestamp;
  readonly viewerOpensAt: Timestamp;
  readonly inputHash?: string;
}

export interface RaceLockSettings {
  readonly conditionProbabilities: Readonly<Record<Condition, number>>;
  readonly simulationNoiseStandardDeviation: number;
  readonly fatigueMaximum: number;
  readonly seedLiquidityClamp?: {
    readonly regular: SeedClamp;
    readonly special: SeedClamp;
  };
  readonly raceBetLimits?: Readonly<Record<RaceKind, number>>;
}

interface SeedClamp {
  readonly winMinimum: number;
  readonly winMaximum: number;
  readonly trifectaMinimum: number;
  readonly trifectaMaximum: number;
}

export interface RegisteredUser {
  readonly id: string;
  readonly accountId: AccountId;
  readonly wasCreated: boolean;
}

interface HorseRow {
  readonly id: string;
  readonly name: string;
  readonly status: HorseWrite['status'];
  readonly runningStyle: HorseWrite['runningStyle'];
  readonly coatColor: HorseCoatColor;
  readonly speed: bigint;
  readonly start: bigint;
  readonly acceleration: bigint;
  readonly stamina: bigint;
  readonly lateKick: bigint;
  readonly conditionStability: bigint;
  readonly distancePreference: bigint;
  readonly surfacePreference: bigint;
  readonly createdAt: bigint;
  readonly updatedAt: bigint;
  readonly retiredAt: bigint | null;
}

interface RaceRow {
  readonly id: string;
  readonly raceDate: string;
  readonly name: string;
  readonly kind: RaceKind;
  readonly status: RaceStatus;
  readonly version: bigint;
  readonly distanceM: bigint;
  readonly surface: RaceRecord['surface'];
  readonly scheduledAt: bigint;
  readonly bettingOpensAt: bigint;
  readonly bettingClosesAt: bigint;
  readonly viewerOpensAt: bigint;
  readonly inputHash: string | null;
}

export class SqliteGameStore {
  private readonly ledger: SqliteLedgerStore;
  private readonly finance: SqliteGameFinanceStore;

  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
  ) {
    this.ledger = new SqliteLedgerStore(database, now);
    this.finance = new SqliteGameFinanceStore(database, now, this.ledger);
  }

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

  public createHorse(input: HorseWrite): HorseRecord {
    validateHorseSnapshot({ ...input, horseId: identifier('validation') });
    const id = ulid();
    const now = BigInt(this.now());
    const legacy = legacyAptitudes(input.distancePreference, input.surfacePreference);
    this.database
      .prepare(
        `INSERT INTO horses
         (id, name, status, running_style, coat_color, speed, start, acceleration, stamina, late_kick,
          condition_stability, aptitude_sprint, aptitude_mile, aptitude_middle, aptitude_long,
          aptitude_firm, aptitude_good, aptitude_heavy, aptitude_turf, aptitude_dirt,
          distance_preference, surface_preference,
          created_at, updated_at, retired_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.status,
        input.runningStyle,
        input.coatColor ?? 'chestnut',
        input.speed,
        input.start,
        input.acceleration,
        input.stamina,
        input.lateKick,
        input.conditionStability,
        legacy.sprint,
        legacy.mile,
        legacy.middle,
        legacy.long,
        legacy.turf,
        legacy.dirt,
        legacy.dirt,
        legacy.turf,
        legacy.dirt,
        input.distancePreference,
        input.surfacePreference,
        now,
        now,
        input.status === 'retired' ? now : null,
      );
    return this.getHorse(id);
  }

  public listHorses(): readonly HorseRecord[] {
    return (
      this.database
        .prepare(
          `SELECT id, name, status, running_style AS runningStyle, coat_color AS coatColor, speed, start,
                  acceleration, stamina, late_kick AS lateKick,
                  condition_stability AS conditionStability,
                  distance_preference AS distancePreference,
                  surface_preference AS surfacePreference,
                  created_at AS createdAt,
                  updated_at AS updatedAt, retired_at AS retiredAt
           FROM horses ORDER BY name`,
        )
        .all() as HorseRow[]
    ).map(mapHorse);
  }

  public updateHorse(id: string, patch: Partial<HorseWrite>): HorseRecord {
    const current = this.getHorse(id);
    const merged: HorseWrite = {
      name: patch.name ?? current.name,
      status: patch.status ?? current.status,
      runningStyle: patch.runningStyle ?? current.runningStyle,
      coatColor: patch.coatColor ?? current.coatColor,
      speed: patch.speed ?? current.speed,
      start: patch.start ?? current.start,
      acceleration: patch.acceleration ?? current.acceleration,
      stamina: patch.stamina ?? current.stamina,
      lateKick: patch.lateKick ?? current.lateKick,
      conditionStability: patch.conditionStability ?? current.conditionStability,
      distancePreference: patch.distancePreference ?? current.distancePreference,
      surfacePreference: patch.surfacePreference ?? current.surfacePreference,
    };
    validateHorseSnapshot({ ...merged, horseId: identifier(id) });
    const now = BigInt(this.now());
    const legacy = legacyAptitudes(merged.distancePreference, merged.surfacePreference);
    this.database
      .prepare(
        `UPDATE horses SET name = ?, status = ?, running_style = ?, coat_color = ?, speed = ?, start = ?,
         acceleration = ?, stamina = ?, late_kick = ?, condition_stability = ?,
         aptitude_sprint = ?, aptitude_mile = ?, aptitude_middle = ?, aptitude_long = ?,
         aptitude_firm = ?, aptitude_good = ?, aptitude_heavy = ?,
         aptitude_turf = ?, aptitude_dirt = ?,
         distance_preference = ?, surface_preference = ?, updated_at = ?,
         retired_at = ? WHERE id = ?`,
      )
      .run(
        merged.name,
        merged.status,
        merged.runningStyle,
        merged.coatColor,
        merged.speed,
        merged.start,
        merged.acceleration,
        merged.stamina,
        merged.lateKick,
        merged.conditionStability,
        legacy.sprint,
        legacy.mile,
        legacy.middle,
        legacy.long,
        legacy.turf,
        legacy.dirt,
        legacy.dirt,
        legacy.turf,
        legacy.dirt,
        merged.distancePreference,
        merged.surfacePreference,
        now,
        merged.status === 'retired' ? (current.retiredAt ?? timestamp(this.now())) : null,
        id,
      );
    return this.getHorse(id);
  }

  public getHorse(id: string): HorseRecord {
    const row = this.database
      .prepare(
        `SELECT id, name, status, running_style AS runningStyle, coat_color AS coatColor, speed, start,
                acceleration, stamina, late_kick AS lateKick,
                condition_stability AS conditionStability,
                distance_preference AS distancePreference,
                surface_preference AS surfacePreference,
                created_at AS createdAt,
                updated_at AS updatedAt, retired_at AS retiredAt
         FROM horses WHERE id = ?`,
      )
      .get(id) as HorseRow | undefined;
    if (row === undefined) throw new Error('Horse not found.');
    return mapHorse(row);
  }

  public createRaceDraft(input: RaceDraftInput): RaceRecord {
    if (input.entries.length !== 8) throw new Error('Eight entries are required.');
    const id = ulid();
    const now = BigInt(this.now());
    const run = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO races
           (id, race_date, name, kind, status, version, distance_m, going, surface, scheduled_at,
            betting_opens_at, betting_closes_at, viewer_opens_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'draft', 0, ?, 'firm', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.raceDate,
          input.name,
          input.kind ?? raceKindForJstDate(input.raceDate),
          input.distanceM,
          input.surface,
          BigInt(input.scheduledAt),
          BigInt(input.bettingOpensAt),
          BigInt(input.bettingClosesAt),
          BigInt(input.viewerOpensAt),
          now,
          now,
        );
      const insertEntry = this.database.prepare(
        `INSERT INTO race_entry_drafts (id, race_id, horse_id, horse_number)
         VALUES (?, ?, ?, ?)`,
      );
      for (const entry of input.entries) {
        insertEntry.run(ulid(), id, entry.horseId, entry.horseNumber);
      }
    });
    run.immediate();
    return this.getRace(id);
  }

  public listRaces(): readonly RaceRecord[] {
    return (
      this.database
        .prepare(
          `SELECT id, race_date AS raceDate, name, kind, status, version,
                  distance_m AS distanceM, surface, scheduled_at AS scheduledAt,
                  betting_opens_at AS bettingOpensAt, betting_closes_at AS bettingClosesAt,
                  viewer_opens_at AS viewerOpensAt, input_hash AS inputHash
           FROM races ORDER BY scheduled_at DESC`,
        )
        .all() as RaceRow[]
    ).map(mapRace);
  }

  public updateRaceDraft(raceId: string, patch: RaceDraftPatch): RaceRecord {
    const run = this.database.transaction(() => {
      const current = this.getRace(raceId);
      if (current.status !== 'draft') throw new Error('Only draft races can be edited.');
      const next = {
        raceDate: patch.raceDate ?? current.raceDate,
        name: patch.name ?? current.name,
        kind: patch.kind ?? current.kind,
        distanceM: patch.distanceM ?? current.distanceM,
        surface: patch.surface ?? current.surface,
        scheduledAt: patch.scheduledAt ?? current.scheduledAt,
        bettingOpensAt: patch.bettingOpensAt ?? current.bettingOpensAt,
        bettingClosesAt: patch.bettingClosesAt ?? current.bettingClosesAt,
        viewerOpensAt: patch.viewerOpensAt ?? current.viewerOpensAt,
      };
      if (
        next.bettingOpensAt >= next.bettingClosesAt ||
        next.bettingClosesAt > next.scheduledAt ||
        next.viewerOpensAt > next.scheduledAt
      ) {
        throw new Error('Race schedule ordering is invalid.');
      }
      this.database
        .prepare(
          `UPDATE races SET race_date = ?, name = ?, kind = ?, distance_m = ?, surface = ?,
           scheduled_at = ?, betting_opens_at = ?, betting_closes_at = ?,
           viewer_opens_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`,
        )
        .run(
          next.raceDate,
          next.name,
          next.kind,
          next.distanceM,
          next.surface,
          BigInt(next.scheduledAt),
          BigInt(next.bettingOpensAt),
          BigInt(next.bettingClosesAt),
          BigInt(next.viewerOpensAt),
          BigInt(this.now()),
          raceId,
        );
      if (patch.entries !== undefined) {
        if (
          patch.entries.length !== 8 ||
          new Set(patch.entries.map((entry) => entry.horseId)).size !== 8 ||
          new Set(patch.entries.map((entry) => entry.horseNumber)).size !== 8
        ) {
          throw new Error('Eight distinct horses and numbers are required.');
        }
        this.database.prepare('DELETE FROM race_entry_drafts WHERE race_id = ?').run(raceId);
        const insert = this.database.prepare(
          'INSERT INTO race_entry_drafts (id, race_id, horse_id, horse_number) VALUES (?, ?, ?, ?)',
        );
        for (const entry of patch.entries) {
          insert.run(ulid(), raceId, entry.horseId, entry.horseNumber);
        }
      }
    });
    run.immediate();
    return this.getRace(raceId);
  }

  public getRace(id: string): RaceRecord {
    const row = this.database
      .prepare(
        `SELECT id, race_date AS raceDate, name, kind, status, version,
                distance_m AS distanceM, surface, scheduled_at AS scheduledAt,
                betting_opens_at AS bettingOpensAt, betting_closes_at AS bettingClosesAt,
                viewer_opens_at AS viewerOpensAt, input_hash AS inputHash
         FROM races WHERE id = ?`,
      )
      .get(id) as RaceRow | undefined;
    if (row === undefined) throw new Error('Race not found.');
    return mapRace(row);
  }

  public lockRace(
    raceId: string,
    randomUnit: () => number,
    settings: RaceLockSettings = DEFAULT_RACE_LOCK_SETTINGS,
  ): RaceRecord {
    const run = this.database.transaction(() => {
      const race = this.getRace(raceId);
      transitionRace(race.status, 'locked');
      const drafts = this.database
        .prepare(
          `SELECT red.horse_number AS horseNumber, h.*
           FROM race_entry_drafts red JOIN horses h ON h.id = red.horse_id
           WHERE red.race_id = ? ORDER BY red.horse_number`,
        )
        .all(raceId) as Array<
        HorseRow & {
          horseNumber: bigint;
          running_style: HorseWrite['runningStyle'];
          condition_stability: bigint;
          late_kick: bigint;
          distance_preference: bigint;
          surface_preference: bigint;
        }
      >;
      if (drafts.length !== 8) throw new Error('Race must have eight available horses.');
      const insert = this.database.prepare(
        `INSERT INTO race_entries
         (id, race_id, horse_id, horse_number, condition, tie_breaker, snapshot_name,
          snapshot_running_style, snapshot_speed, snapshot_start, snapshot_acceleration,
          snapshot_stamina, snapshot_late_kick, snapshot_condition_stability,
          snapshot_aptitude_sprint, snapshot_aptitude_mile, snapshot_aptitude_middle,
          snapshot_aptitude_long, snapshot_aptitude_firm, snapshot_aptitude_good,
          snapshot_aptitude_heavy, snapshot_aptitude_turf, snapshot_aptitude_dirt,
          snapshot_distance_preference, snapshot_surface_preference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const snapshotForHash: RaceEntry[] = [];
      for (const draft of drafts) {
        const condition = selectCondition(randomUnit(), settings.conditionProbabilities);
        const tieBreaker = randomUnit();
        const legacy = legacyAptitudes(
          Number(draft.distance_preference),
          Number(draft.surface_preference),
        );
        insert.run(
          ulid(),
          raceId,
          draft.id,
          draft.horseNumber,
          condition,
          tieBreaker,
          draft.name,
          draft.running_style,
          draft.speed,
          draft.start,
          draft.acceleration,
          draft.stamina,
          draft.late_kick,
          draft.condition_stability,
          legacy.sprint,
          legacy.mile,
          legacy.middle,
          legacy.long,
          legacy.turf,
          legacy.dirt,
          legacy.dirt,
          legacy.turf,
          legacy.dirt,
          draft.distance_preference,
          draft.surface_preference,
        );
        snapshotForHash.push({
          horseNumber: Number(draft.horseNumber),
          condition,
          tieBreaker,
          horse: {
            horseId: identifier(draft.id),
            name: draft.name,
            runningStyle: draft.running_style,
            speed: Number(draft.speed),
            start: Number(draft.start),
            acceleration: Number(draft.acceleration),
            stamina: Number(draft.stamina),
            lateKick: Number(draft.late_kick),
            conditionStability: Number(draft.condition_stability),
            distancePreference: Number(draft.distance_preference),
            surfacePreference: Number(draft.surface_preference),
          },
        });
      }
      const inputHash = hashSimulationInput({
        raceId,
        raceVersion: race.version + 1,
        distanceM: race.distanceM,
        surface: race.surface,
        entries: snapshotForHash,
        noiseStandardDeviation: settings.simulationNoiseStandardDeviation,
        fatigueMaximum: settings.fatigueMaximum,
      });
      this.database
        .prepare(
          `UPDATE races SET status = 'locked', version = version + 1,
           input_hash = ?, simulation_config_json = ?, updated_at = ?
           WHERE id = ? AND status = 'draft'`,
        )
        .run(
          inputHash,
          JSON.stringify({
            noiseStandardDeviation: settings.simulationNoiseStandardDeviation,
            fatigueMaximum: settings.fatigueMaximum,
            seedLiquidityClamp: settings.seedLiquidityClamp ?? DEFAULT_SEED_LIQUIDITY_CLAMP,
            raceBetLimits: settings.raceBetLimits ?? DEFAULT_RACE_BET_LIMITS,
          }),
          BigInt(this.now()),
          raceId,
        );
    });
    run.immediate();
    return this.getRace(raceId);
  }

  public unlockRace(raceId: string): RaceRecord {
    const run = this.database.transaction(() => {
      const race = this.getRace(raceId);
      transitionRace(race.status, 'draft');
      this.database.prepare('DELETE FROM race_entries WHERE race_id = ?').run(raceId);
      this.database
        .prepare(
          `UPDATE races SET status = 'draft', version = version + 1,
           input_hash = NULL, updated_at = ? WHERE id = ? AND status = 'locked'`,
        )
        .run(BigInt(this.now()), raceId);
    });
    run.immediate();
    return this.getRace(raceId);
  }

  public openBettingPools(input: OpenBettingPoolsInput): void {
    this.finance.openBettingPools(input);
  }

  public purchaseBet(input: PurchaseBetInput): PurchasedBet {
    return this.finance.purchaseBet(input);
  }

  public grantDailyRelief(jstDate: string): number {
    return this.finance.grantDailyRelief(jstDate);
  }

  public planSeedLiquidity(raceId: string) {
    return this.finance.planSeedLiquidity(raceId);
  }

  public ledgerStore(): SqliteLedgerStore {
    return this.ledger;
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

function mapHorse(row: HorseRow): HorseRecord {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    runningStyle: row.runningStyle,
    coatColor: row.coatColor,
    speed: Number(row.speed),
    start: Number(row.start),
    acceleration: Number(row.acceleration),
    stamina: Number(row.stamina),
    lateKick: Number(row.lateKick),
    conditionStability: Number(row.conditionStability),
    distancePreference: Number(row.distancePreference),
    surfacePreference: Number(row.surfacePreference),
    createdAt: timestamp(Number(row.createdAt)),
    updatedAt: timestamp(Number(row.updatedAt)),
    ...(row.retiredAt === null ? {} : { retiredAt: timestamp(Number(row.retiredAt)) }),
  };
}

function mapRace(row: RaceRow): RaceRecord {
  return {
    id: row.id,
    raceDate: row.raceDate,
    name: row.name,
    kind: row.kind,
    status: row.status,
    version: Number(row.version),
    distanceM: Number(row.distanceM),
    surface: row.surface,
    scheduledAt: timestamp(Number(row.scheduledAt)),
    bettingOpensAt: timestamp(Number(row.bettingOpensAt)),
    bettingClosesAt: timestamp(Number(row.bettingClosesAt)),
    viewerOpensAt: timestamp(Number(row.viewerOpensAt)),
    ...(row.inputHash === null ? {} : { inputHash: row.inputHash }),
  };
}

function legacyAptitudes(
  distancePreference: number,
  surfacePreference: number,
): {
  readonly sprint: number;
  readonly mile: number;
  readonly middle: number;
  readonly long: number;
  readonly turf: number;
  readonly dirt: number;
} {
  const ability = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
  return {
    sprint: ability(50 - distancePreference / 2),
    mile: ability(50 - distancePreference / 6),
    middle: ability(50 + distancePreference / 6),
    long: ability(50 + distancePreference / 2),
    turf: ability(50 - surfacePreference / 2),
    dirt: ability(50 + surfacePreference / 2),
  };
}

const DEFAULT_RACE_LOCK_SETTINGS: RaceLockSettings = {
  conditionProbabilities: {
    terrible: 0.1,
    poor: 0.2,
    normal: 0.4,
    good: 0.2,
    excellent: 0.1,
  },
  simulationNoiseStandardDeviation: 0.022,
  fatigueMaximum: 0.12,
};

const DEFAULT_SEED_LIQUIDITY_CLAMP = {
  regular: {
    winMinimum: 5_000,
    winMaximum: 25_000,
    trifectaMinimum: 10_000,
    trifectaMaximum: 40_000,
  },
  special: {
    winMinimum: 10_000,
    winMaximum: 50_000,
    trifectaMinimum: 20_000,
    trifectaMaximum: 80_000,
  },
} as const;

const DEFAULT_RACE_BET_LIMITS: Readonly<Record<RaceKind, number>> = {
  regular: 5_000,
  midweek: 10_000,
  saturday_night: 20_000,
};

function selectCondition(
  randomUnit: number,
  probabilities: Readonly<Record<Condition, number>>,
): Condition {
  if (randomUnit < 0 || randomUnit >= 1) throw new Error('Random unit must be in [0, 1).');
  let cumulative = 0;
  for (const condition of ['terrible', 'poor', 'normal', 'good'] as const) {
    cumulative += probabilities[condition];
    if (randomUnit < cumulative) return condition;
  }
  return 'excellent';
}
