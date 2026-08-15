import type Database from 'better-sqlite3';
import type { Timestamp } from '@jcb/domain';
import { SqliteAdminCommandStore, type AdminAuditInput } from './admin-command-store.js';
import { SqliteAdminHealthStore, type AdminHealth } from './admin-health-store.js';
import { SqliteAdminReadStore } from './admin-read-store.js';

/** Stable facade over separate administration query and command stores. */
export class SqliteAdminStore {
  private readonly reads: SqliteAdminReadStore;
  private readonly commands: SqliteAdminCommandStore;
  private readonly healthStore: SqliteAdminHealthStore;

  public constructor(database: Database.Database, now: () => number) {
    this.reads = new SqliteAdminReadStore(database);
    this.commands = new SqliteAdminCommandStore(database, now);
    this.healthStore = new SqliteAdminHealthStore(database, now);
  }

  public listLedger(limit = 200): readonly Record<string, string | null>[] {
    return this.reads.listLedger(limit);
  }

  public horsePerformance(horseId: string): {
    readonly starts: number;
    readonly wins: number;
    readonly topThreeFinishes: number;
    readonly history: readonly Record<string, string | number | null>[];
  } {
    return this.reads.horsePerformance(horseId);
  }

  public listRaceOperations(limit = 500): readonly Record<string, string | number | null>[] {
    return this.reads.listRaceOperations(limit);
  }

  public economyOperations(limit = 300): {
    readonly accounts: readonly Record<string, string | number | null>[];
    readonly bets: readonly Record<string, string | number | null>[];
    readonly settlements: readonly Record<string, string | number | null>[];
    readonly carryover: Record<string, string | number | null> | null;
    readonly seedPositions: readonly Record<string, string | number | null>[];
    readonly relief: readonly Record<string, string | number | null>[];
  } {
    return this.reads.economyOperations(limit);
  }

  public systemObjects(limit = 500): {
    readonly discordMessages: readonly Record<string, string | number | null>[];
    readonly timelineObjects: readonly Record<string, string | number | null>[];
    readonly objectPublications: readonly Record<string, string | number | null>[];
  } {
    return this.reads.systemObjects(limit);
  }

  public adjustBalance(input: {
    readonly targetAccountId: string;
    readonly signedAmount: bigint;
    readonly reason: string;
    readonly idempotencyKey: string;
    readonly actorUserId: string;
  }): string {
    return this.commands.adjustBalance(input);
  }

  public listJobs(limit = 200): readonly Record<string, string | null>[] {
    return this.reads.listJobs(limit);
  }

  public retryJob(jobId: string, at: Timestamp): void {
    this.commands.retryJob(jobId, at);
  }

  public listAudit(limit = 200): readonly Record<string, string | null>[] {
    return this.reads.listAudit(limit);
  }

  public listAdministrators(): readonly {
    readonly discordUserId: string;
    readonly createdAt: string;
  }[] {
    return this.reads.listAdministrators();
  }

  public addAdministrator(input: {
    readonly discordUserId: string;
    readonly actorUserId: string;
    readonly reason: string;
  }): void {
    this.commands.addAdministrator(input);
  }

  public removeAdministrator(input: {
    readonly discordUserId: string;
    readonly actorUserId: string;
    readonly reason: string;
  }): void {
    this.commands.removeAdministrator(input);
  }

  public recordAudit(input: AdminAuditInput): void {
    this.commands.recordAudit(input);
  }

  public ensureSetting(key: string, value: unknown): void {
    this.commands.ensureSetting(key, value);
  }

  public recordSystemSetting(key: string, value: unknown): void {
    this.commands.recordSystemSetting(key, value);
  }

  public getSetting(key: string): unknown {
    return this.commands.getSetting(key);
  }

  public updateSetting(input: {
    readonly key: string;
    readonly value: unknown;
    readonly actorUserId: string;
    readonly reason: string;
  }): void {
    this.commands.updateSetting(input);
  }

  public listSettingHistory(
    key: string,
    limit = 50,
  ): readonly {
    readonly id: string;
    readonly value: unknown;
    readonly updatedByUserId: string | null;
    readonly updatedAt: string;
  }[] {
    return this.reads.listSettingHistory(key, limit);
  }

  public health(): AdminHealth {
    return this.healthStore.health();
  }

  public probeDatabaseReadWrite(): boolean {
    return this.healthStore.probeDatabaseReadWrite();
  }
}
