import type { Condition, Money, PoolType, Timestamp } from '@jcb/domain';

export interface DiscordRaceHorse {
  readonly horseNumber: number;
  readonly name: string;
  readonly condition: Condition;
  readonly currentWinOdds: string;
}

export interface DiscordRaceCard {
  readonly raceId: string;
  readonly version: number;
  readonly name: string;
  readonly raceDate: string;
  readonly distanceM: number;
  readonly surfaceLabel: string;
  readonly horses: readonly DiscordRaceHorse[];
  readonly trifectaPoolTotal: Money;
  readonly carryover: Money;
  readonly canBuy: boolean;
  readonly canView: boolean;
}

export interface PurchaseSession {
  readonly id: string;
  readonly discordUserId: string;
  readonly raceId: string;
  readonly raceVersion: number;
  readonly step: string;
  readonly payload: Readonly<Record<string, string>>;
  readonly expiresAt: Timestamp;
}

export interface PurchaseSessionStore {
  create(input: Omit<PurchaseSession, 'id'>): PurchaseSession;
  get(id: string): PurchaseSession | undefined;
  update(
    id: string,
    expectedStep: string,
    step: string,
    payload: Readonly<Record<string, string>>,
  ): PurchaseSession;
}

export interface PurchasePreview {
  readonly estimatedBasePayout: Money;
  readonly estimatedCarryoverBonus: Money;
  readonly balanceAfter: Money;
}

export interface PurchaseReceipt {
  readonly betId: string;
  readonly balanceAfter: Money;
  readonly wasDuplicate: boolean;
}

export interface DiscordPurchaseGateway {
  currentRaceVersion(raceId: string): Promise<number>;
  preview(input: {
    readonly discordUserId: string;
    readonly raceId: string;
    readonly poolType: PoolType;
    readonly selectionCode: string;
    readonly stake: Money;
  }): Promise<PurchasePreview>;
  purchase(input: {
    readonly discordUserId: string;
    readonly raceId: string;
    readonly raceVersion: number;
    readonly poolType: PoolType;
    readonly selectionCode: string;
    readonly stake: Money;
    readonly interactionId: string;
    readonly operationId: string;
  }): Promise<PurchaseReceipt>;
  raceHorses(
    raceId: string,
  ): Promise<readonly { readonly number: number; readonly name: string }[]>;
}
