export interface Horse {
  readonly id: string;
  readonly name: string;
  readonly status: 'active' | 'resting' | 'retired';
  readonly runningStyle: 'front_runner' | 'closer';
  readonly coatColor: 'black' | 'chestnut' | 'gray' | 'cream';
  readonly speed: number;
  readonly start: number;
  readonly acceleration: number;
  readonly stamina: number;
  readonly lateKick: number;
  readonly conditionStability: number;
  readonly distancePreference: number;
  readonly surfacePreference: number;
}

export interface HorsePerformance {
  readonly starts: number;
  readonly wins: number;
  readonly topThreeFinishes: number;
  readonly history: readonly {
    readonly raceId: string;
    readonly raceDate: string;
    readonly raceName: string;
    readonly distanceM: string;
    readonly surface: 'turf' | 'dirt';
    readonly horseNumber: string;
    readonly condition: string;
    readonly finishPosition: string | null;
    readonly finishTimeMs: string | null;
  }[];
}

export function horseCoatLabel(coatColor: Horse['coatColor']): string {
  const labels: Readonly<Record<Horse['coatColor'], string>> = {
    black: '黒',
    chestnut: '栗毛',
    gray: 'グレー',
    cream: 'クリーム',
  };
  return labels[coatColor];
}
