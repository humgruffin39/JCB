export interface HorseOption {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

export interface AdminRace {
  readonly id: string;
  readonly raceDate: string;
  readonly name: string;
  readonly status: string;
  readonly version: number | string;
  readonly kind: 'regular' | 'midweek' | 'saturday_night';
  readonly distanceM: number | string;
  readonly surface: 'turf' | 'dirt';
  readonly scheduledAt: string;
  readonly bettingOpensAt: string;
  readonly bettingClosesAt: string;
  readonly viewerOpensAt: string;
  readonly entriesJson: string;
  readonly officialSimulationStatus: string | null;
  readonly oddsSimulationStatus: string | null;
  readonly oddsSelectionCount: string;
  readonly minimumBaseOdds: number | string | null;
  readonly maximumBaseOdds: number | string | null;
  readonly seedLiquidity: string;
  readonly seedLiquidityDiagnosticsJson: string | null;
  readonly timelineObjectKey: string | null;
}

export interface RaceEntrySelection {
  readonly horseId: string;
  readonly horseNumber: number;
  readonly condition?: string;
}

export interface ScheduleSettings {
  readonly recommendedLockTime: string;
  readonly viewerOpenTime: string;
  readonly bettingCloseTime: string;
  readonly startTime: string;
}

export const DEFAULT_SCHEDULE: ScheduleSettings = {
  recommendedLockTime: '18:00:00',
  viewerOpenTime: '21:55:00',
  bettingCloseTime: '21:59:30',
  startTime: '22:00:00',
};

export const DISTANCE_OPTIONS = [1_200, 1_600, 1_800, 2_000, 2_400] as const;
