import {
  DomainError,
  money,
  nonNegativeMoney,
  type Money,
  type PoolType,
  type RaceKind,
  type RaceStatus,
  type Timestamp,
} from '@jcb/domain';

export const MINIMUM_BET = money(100n);

export const RACE_BET_LIMITS: Readonly<Record<RaceKind, Money>> = {
  regular: money(5_000n),
  midweek: money(10_000n),
  saturday_night: money(20_000n),
};

export interface PurchaseValidation {
  readonly isUserActive: boolean;
  readonly isGuildMember: boolean;
  readonly raceStatus: RaceStatus;
  readonly now: Timestamp;
  readonly bettingClosesAt: Timestamp;
  readonly expectedRaceVersion: number;
  readonly currentRaceVersion: number;
  readonly stake: Money;
  readonly balance: Money;
  readonly userRaceStake: Money;
  readonly raceKind: RaceKind;
  readonly raceBetLimit?: Money;
  readonly poolType: PoolType;
  readonly selectionCode: string;
}

export function validatePurchase(input: PurchaseValidation): void {
  if (!input.isUserActive || !input.isGuildMember) {
    throw new DomainError(
      'BETTING_CLOSED',
      'Current guild membership and an active user are required.',
    );
  }
  if (input.raceStatus !== 'betting_open' || input.now >= input.bettingClosesAt) {
    throw new DomainError('BETTING_CLOSED', 'Betting is closed.');
  }
  if (input.currentRaceVersion !== input.expectedRaceVersion) {
    throw new DomainError('INVALID_RACE_ENTRY', 'Race version changed; restart the purchase flow.');
  }
  if (input.stake < MINIMUM_BET) {
    throw new DomainError('INVALID_MONEY', 'The minimum stake is 100 rupees.');
  }
  if (input.balance < input.stake) {
    throw new DomainError('INSUFFICIENT_FUNDS', 'Insufficient balance.');
  }
  if (input.userRaceStake + input.stake > (input.raceBetLimit ?? RACE_BET_LIMITS[input.raceKind])) {
    throw new DomainError('RACE_BET_LIMIT_EXCEEDED', 'Per-race stake limit exceeded.');
  }
}

export function estimatedGrossPayout(
  betAmount: Money,
  poolTotal: Money,
  selectionTotal: Money,
): Money {
  if (betAmount <= 0n || poolTotal < 0n || selectionTotal < 0n) {
    throw new DomainError('INVALID_MONEY', 'Payout estimate inputs are invalid.');
  }
  return nonNegativeMoney((betAmount * (poolTotal + betAmount)) / (selectionTotal + betAmount));
}
