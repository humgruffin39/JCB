import type { RaceWorldState } from './race-world-types.js';

type CameraFrameHorse = RaceWorldState['frame']['horses'][number];

/** Tracks brief broadcast cutaways around meaningful mid-race overtakes. */
export class RaceCameraBattleTracker {
  private readonly previousRanks = new Map<number, number>();
  private horseNumbers: readonly [number, number] | undefined;
  private untilMs = 0;
  private lastCutMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly distanceM: number) {}

  update(state: RaceWorldState, focusRaceProgress: number, rewound: boolean): void {
    if (rewound) {
      this.previousRanks.clear();
      this.horseNumbers = undefined;
      this.untilMs = 0;
      this.lastCutMs = state.positionMs - 12_000;
    }

    let overtaker: CameraFrameHorse | undefined;
    let largestGain = 0;
    for (const horse of state.frame.horses) {
      const previousRank = this.previousRanks.get(horse.horseNumber);
      const gain = previousRank === undefined ? 0 : previousRank - horse.rank;
      if (gain > largestGain) {
        largestGain = gain;
        overtaker = horse;
      }
      this.previousRanks.set(horse.horseNumber, horse.rank);
    }

    if (
      overtaker !== undefined &&
      focusRaceProgress >= 0.35 &&
      focusRaceProgress <= 0.9 &&
      state.positionMs - this.lastCutMs >= 18_000
    ) {
      let rival: CameraFrameHorse | undefined;
      for (const candidate of state.frame.horses) {
        if (candidate.horseNumber === overtaker.horseNumber) continue;
        if (rival === undefined || isCloserRival(candidate, rival, overtaker)) rival = candidate;
      }
      const gapMetres =
        rival === undefined
          ? Number.POSITIVE_INFINITY
          : Math.abs(rival.progress - overtaker.progress) * this.distanceM;
      if (rival !== undefined && gapMetres <= 6.5) {
        this.horseNumbers = [overtaker.horseNumber, rival.horseNumber];
        this.untilMs = state.positionMs + 3_200;
        this.lastCutMs = state.positionMs;
      }
    }

    if (state.isPhoto || state.positionMs > this.untilMs) this.horseNumbers = undefined;
  }

  focusProgressFor(state: RaceWorldState): number | undefined {
    if (this.horseNumbers === undefined || state.positionMs > this.untilMs) return undefined;
    const left = state.frame.horses.find((horse) => horse.horseNumber === this.horseNumbers?.[0]);
    const right = state.frame.horses.find((horse) => horse.horseNumber === this.horseNumbers?.[1]);
    return left === undefined || right === undefined
      ? undefined
      : (left.progress + right.progress) / 2;
  }
}

function isCloserRival(
  candidate: CameraFrameHorse,
  current: CameraFrameHorse,
  overtaker: CameraFrameHorse,
): boolean {
  const candidateRankGap = Math.abs(candidate.rank - overtaker.rank);
  const currentRankGap = Math.abs(current.rank - overtaker.rank);
  return (
    candidateRankGap < currentRankGap ||
    (candidateRankGap === currentRankGap &&
      Math.abs(candidate.progress - overtaker.progress) <
        Math.abs(current.progress - overtaker.progress))
  );
}
