export type BroadcastShotId =
  | 'break'
  | 'launch-track'
  | 'first-turn-tower'
  | 'turn-exit'
  | 'backstretch-track'
  | 'rear-quarter'
  | 'backstretch-tower'
  | 'far-turn-head-on'
  | 'final-turn-track'
  | 'home-stretch-track'
  | 'finish-line'
  | 'battle-track';

export interface BroadcastCameraShot {
  readonly id: BroadcastShotId;
  readonly movement: 'fixed' | 'tracking';
  readonly anchorRaceProgress?: number;
  readonly tangentOffset: number;
  readonly normalOffset: number;
  readonly height: number;
  readonly lookAhead: number;
  readonly lookHeight: number;
  readonly fieldOfView: number;
  readonly positionDamping: number;
  readonly targetDamping: number;
}

const SHOTS = {
  break: {
    id: 'break',
    movement: 'fixed',
    anchorRaceProgress: 0.012,
    tangentOffset: 11,
    normalOffset: 9,
    height: 3.4,
    lookAhead: -1.5,
    lookHeight: 1.45,
    fieldOfView: 31,
    positionDamping: 8,
    targetDamping: 8,
  },
  launchTrack: {
    id: 'launch-track',
    movement: 'tracking',
    tangentOffset: -1.5,
    normalOffset: 20,
    height: 3.9,
    lookAhead: 1.2,
    lookHeight: 1.4,
    fieldOfView: 34,
    positionDamping: 5.8,
    targetDamping: 7,
  },
  firstTurnTower: {
    id: 'first-turn-tower',
    movement: 'fixed',
    anchorRaceProgress: 0.175,
    tangentOffset: 1,
    normalOffset: 28,
    height: 9.5,
    lookAhead: 1,
    lookHeight: 1.25,
    fieldOfView: 28,
    positionDamping: 5,
    targetDamping: 6.5,
  },
  turnExit: {
    id: 'turn-exit',
    movement: 'tracking',
    tangentOffset: 9,
    normalOffset: 18,
    height: 5.5,
    lookAhead: -0.5,
    lookHeight: 1.35,
    fieldOfView: 29,
    positionDamping: 4.8,
    targetDamping: 6.2,
  },
  backstretchTrack: {
    id: 'backstretch-track',
    movement: 'tracking',
    tangentOffset: -1,
    normalOffset: 16,
    height: 3.35,
    lookAhead: -1.5,
    lookHeight: 1.35,
    fieldOfView: 29,
    positionDamping: 5.8,
    targetDamping: 7,
  },
  rearQuarter: {
    id: 'rear-quarter',
    movement: 'tracking',
    tangentOffset: -12,
    normalOffset: -5,
    height: 4,
    lookAhead: 5.5,
    lookHeight: 1.45,
    fieldOfView: 31,
    positionDamping: 4.6,
    targetDamping: 5.5,
  },
  backstretchTower: {
    id: 'backstretch-tower',
    movement: 'fixed',
    anchorRaceProgress: 0.59,
    tangentOffset: 5,
    normalOffset: 29,
    height: 9.8,
    lookAhead: 0.5,
    lookHeight: 1.25,
    fieldOfView: 28,
    positionDamping: 5,
    targetDamping: 6.5,
  },
  farTurnHeadOn: {
    id: 'far-turn-head-on',
    movement: 'tracking',
    tangentOffset: 23,
    normalOffset: 2,
    height: 6.2,
    lookAhead: 0,
    lookHeight: 1.35,
    fieldOfView: 26,
    positionDamping: 5.8,
    targetDamping: 7.5,
  },
  finalTurnTrack: {
    id: 'final-turn-track',
    movement: 'tracking',
    tangentOffset: 8,
    normalOffset: 18,
    height: 5.8,
    lookAhead: -0.5,
    lookHeight: 1.4,
    fieldOfView: 27,
    positionDamping: 5.2,
    targetDamping: 7,
  },
  homeStretchTrack: {
    id: 'home-stretch-track',
    movement: 'tracking',
    tangentOffset: 1.5,
    normalOffset: 15,
    height: 3.7,
    lookAhead: 0.8,
    lookHeight: 1.45,
    fieldOfView: 25,
    positionDamping: 6.2,
    targetDamping: 8,
  },
  finishLine: {
    id: 'finish-line',
    movement: 'fixed',
    anchorRaceProgress: 1,
    tangentOffset: 0,
    normalOffset: -16,
    height: 3.4,
    lookAhead: 0,
    lookHeight: 1.35,
    fieldOfView: 30,
    positionDamping: 7,
    targetDamping: 10,
  },
  battleTrack: {
    id: 'battle-track',
    movement: 'tracking',
    tangentOffset: 2,
    normalOffset: 14,
    height: 3.25,
    lookAhead: 0.6,
    lookHeight: 1.42,
    fieldOfView: 23,
    positionDamping: 6.4,
    targetDamping: 8,
  },
} as const satisfies Record<string, BroadcastCameraShot>;

export function selectBroadcastCameraShot(raceProgress: number): BroadcastCameraShot {
  const progress = Math.max(0, Math.min(1, raceProgress));
  if (progress < 0.035) return SHOTS.break;
  if (progress < 0.1) return SHOTS.launchTrack;
  if (progress < 0.22) return SHOTS.firstTurnTower;
  if (progress < 0.32) return SHOTS.turnExit;
  if (progress < 0.45) return SHOTS.backstretchTrack;
  if (progress < 0.56) return SHOTS.rearQuarter;
  if (progress < 0.65) return SHOTS.backstretchTower;
  if (progress < 0.78) return SHOTS.farTurnHeadOn;
  if (progress < 0.865) return SHOTS.finalTurnTrack;
  return SHOTS.homeStretchTrack;
}

export function getFinishCameraShot(): BroadcastCameraShot {
  return SHOTS.finishLine;
}

export function getBattleCameraShot(): BroadcastCameraShot {
  return SHOTS.battleTrack;
}
