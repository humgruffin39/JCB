export type BroadcastShotId =
  | 'break'
  | 'launch-track'
  | 'first-turn-tower'
  | 'turn-exit'
  | 'backstretch-wide'
  | 'backstretch-track'
  | 'rear-quarter'
  | 'backstretch-tower'
  | 'far-turn-wide'
  | 'far-turn-head-on'
  | 'final-turn-wide'
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
    tangentOffset: 13,
    normalOffset: 15,
    height: 4.8,
    lookAhead: -1.5,
    lookHeight: 1.45,
    fieldOfView: 34,
    positionDamping: 8,
    targetDamping: 8,
  },
  launchTrack: {
    id: 'launch-track',
    movement: 'tracking',
    tangentOffset: -1.5,
    normalOffset: 25,
    height: 5.4,
    lookAhead: 1.2,
    lookHeight: 1.4,
    fieldOfView: 35,
    positionDamping: 5.8,
    targetDamping: 7,
  },
  firstTurnTower: {
    id: 'first-turn-tower',
    movement: 'fixed',
    anchorRaceProgress: 0.175,
    tangentOffset: 1,
    normalOffset: 31,
    height: 10.5,
    lookAhead: 1,
    lookHeight: 1.25,
    fieldOfView: 32,
    positionDamping: 5,
    targetDamping: 6.5,
  },
  turnExit: {
    id: 'turn-exit',
    movement: 'tracking',
    tangentOffset: 11,
    normalOffset: 25,
    height: 6.8,
    lookAhead: -0.5,
    lookHeight: 1.35,
    fieldOfView: 33,
    positionDamping: 4.8,
    targetDamping: 6.2,
  },
  backstretchWide: {
    id: 'backstretch-wide',
    movement: 'fixed',
    anchorRaceProgress: 0.39,
    tangentOffset: 8,
    normalOffset: 32,
    height: 10.5,
    lookAhead: 0,
    lookHeight: 1.3,
    fieldOfView: 33,
    positionDamping: 5,
    targetDamping: 6.5,
  },
  backstretchTrack: {
    id: 'backstretch-track',
    movement: 'tracking',
    tangentOffset: -1,
    normalOffset: 24,
    height: 5.8,
    lookAhead: -1.5,
    lookHeight: 1.35,
    fieldOfView: 33,
    positionDamping: 5.8,
    targetDamping: 7,
  },
  rearQuarter: {
    id: 'rear-quarter',
    movement: 'tracking',
    tangentOffset: -16,
    normalOffset: -22,
    height: 6.2,
    lookAhead: 5.5,
    lookHeight: 1.45,
    fieldOfView: 34,
    positionDamping: 4.6,
    targetDamping: 5.5,
  },
  backstretchTower: {
    id: 'backstretch-tower',
    movement: 'fixed',
    anchorRaceProgress: 0.53,
    tangentOffset: 5,
    normalOffset: 32,
    height: 11,
    lookAhead: 0.5,
    lookHeight: 1.25,
    fieldOfView: 32,
    positionDamping: 5,
    targetDamping: 6.5,
  },
  farTurnWide: {
    id: 'far-turn-wide',
    movement: 'fixed',
    anchorRaceProgress: 0.72,
    tangentOffset: 4,
    normalOffset: 30,
    height: 10.2,
    lookAhead: 0.5,
    lookHeight: 1.3,
    fieldOfView: 33,
    positionDamping: 5,
    targetDamping: 6.5,
  },
  farTurnHeadOn: {
    id: 'far-turn-head-on',
    movement: 'tracking',
    tangentOffset: 30,
    normalOffset: 12,
    height: 8,
    lookAhead: 0,
    lookHeight: 1.35,
    fieldOfView: 32,
    positionDamping: 5.8,
    targetDamping: 7.5,
  },
  finalTurnWide: {
    id: 'final-turn-wide',
    movement: 'fixed',
    anchorRaceProgress: 0.86,
    tangentOffset: 5,
    normalOffset: 30,
    height: 10.2,
    lookAhead: 0.5,
    lookHeight: 1.35,
    fieldOfView: 33,
    positionDamping: 5,
    targetDamping: 6.5,
  },
  finalTurnTrack: {
    id: 'final-turn-track',
    movement: 'tracking',
    tangentOffset: 14,
    normalOffset: 25,
    height: 7.2,
    lookAhead: -0.5,
    lookHeight: 1.4,
    fieldOfView: 32,
    positionDamping: 5.2,
    targetDamping: 7,
  },
  homeStretchTrack: {
    id: 'home-stretch-track',
    movement: 'fixed',
    anchorRaceProgress: 0.93,
    tangentOffset: 20,
    normalOffset: -30,
    height: 8.5,
    lookAhead: 0.5,
    lookHeight: 1.45,
    fieldOfView: 34,
    positionDamping: 5.2,
    targetDamping: 6.8,
  },
  finishLine: {
    id: 'finish-line',
    movement: 'fixed',
    anchorRaceProgress: 1,
    tangentOffset: 0,
    normalOffset: -24,
    height: 4.8,
    lookAhead: 0,
    lookHeight: 1.2,
    fieldOfView: 34,
    positionDamping: 7,
    targetDamping: 10,
  },
  battleTrack: {
    id: 'battle-track',
    movement: 'tracking',
    tangentOffset: 4,
    normalOffset: 22,
    height: 6,
    lookAhead: 0.6,
    lookHeight: 1.42,
    fieldOfView: 31,
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
  if (progress < 0.39) return SHOTS.backstretchWide;
  if (progress < 0.48) return SHOTS.backstretchTrack;
  if (progress < 0.56) return SHOTS.backstretchTower;
  if (progress < 0.65) return SHOTS.rearQuarter;
  if (progress < 0.73) return SHOTS.farTurnWide;
  if (progress < 0.82) return SHOTS.farTurnHeadOn;
  if (progress < 0.88) return SHOTS.finalTurnWide;
  if (progress < 0.93) return SHOTS.finalTurnTrack;
  return SHOTS.homeStretchTrack;
}

export function getFinishCameraShot(): BroadcastCameraShot {
  return SHOTS.finishLine;
}

export function getBattleCameraShot(): BroadcastCameraShot {
  return SHOTS.battleTrack;
}
