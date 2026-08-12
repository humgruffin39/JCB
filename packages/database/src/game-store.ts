import type Database from 'better-sqlite3';
import {
  SqliteGameFinanceStore,
  type OpenBettingPoolsInput,
  type PurchaseBetInput,
  type PurchasedBet,
} from './game-finance-store.js';
import { SqliteHorseStore } from './game-horse-store.js';
import { SqliteLedgerStore } from './ledger-store.js';
import { SqliteRaceStore } from './game-race-store.js';
import { SqliteGameUserStore } from './game-user-store.js';
import type {
  HorseRecord,
  HorseWrite,
  RaceDraftInput,
  RaceDraftPatch,
  RaceLockSettings,
  RaceRecord,
  RegisteredUser,
} from './game-store-types.js';

export type { PurchaseBetInput, PurchasedBet } from './game-finance-store.js';
export type {
  HorseRecord,
  HorseWrite,
  RaceEntryDraftInput,
  RaceDraftInput,
  RaceDraftPatch,
  RaceLockSettings,
  RaceRecord,
  RegisteredUser,
} from './game-store-types.js';

export class SqliteGameStore {
  private readonly ledger: SqliteLedgerStore;
  private readonly finance: SqliteGameFinanceStore;
  private readonly users: SqliteGameUserStore;
  private readonly horses: SqliteHorseStore;
  private readonly races: SqliteRaceStore;

  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
  ) {
    this.ledger = new SqliteLedgerStore(database, now);
    this.finance = new SqliteGameFinanceStore(database, now, this.ledger);
    this.users = new SqliteGameUserStore(database, now, this.ledger);
    this.horses = new SqliteHorseStore(database, now);
    this.races = new SqliteRaceStore(database, now);
  }

  public initializeEconomy(initialAdminDiscordIds: readonly string[]): void {
    this.users.initializeEconomy(initialAdminDiscordIds);
  }

  public registerUser(
    discordUserId: string,
    displayName: string,
    isGuildMember: boolean,
  ): RegisteredUser {
    return this.users.registerUser(discordUserId, displayName, isGuildMember);
  }

  public createHorse(input: HorseWrite): HorseRecord {
    return this.horses.createHorse(input);
  }

  public listHorses(): readonly HorseRecord[] {
    return this.horses.listHorses();
  }

  public updateHorse(id: string, patch: Partial<HorseWrite>): HorseRecord {
    return this.horses.updateHorse(id, patch);
  }

  public getHorse(id: string): HorseRecord {
    return this.horses.getHorse(id);
  }

  public createRaceDraft(input: RaceDraftInput): RaceRecord {
    return this.races.createRaceDraft(input);
  }

  public listRaces(): readonly RaceRecord[] {
    return this.races.listRaces();
  }

  public updateRaceDraft(raceId: string, patch: RaceDraftPatch): RaceRecord {
    return this.races.updateRaceDraft(raceId, patch);
  }

  public getRace(id: string): RaceRecord {
    return this.races.getRace(id);
  }

  public lockRace(
    raceId: string,
    randomUnit: () => number,
    settings?: RaceLockSettings,
  ): RaceRecord {
    return settings === undefined
      ? this.races.lockRace(raceId, randomUnit)
      : this.races.lockRace(raceId, randomUnit, settings);
  }

  public unlockRace(raceId: string): RaceRecord {
    return this.races.unlockRace(raceId);
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
}
