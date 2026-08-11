import * as THREE from 'three';
import { courseTurnAmount, raceProgressToCourseProgress, TRACK_HALF_WIDTH } from './race-course.js';

const START_LANE_ORIGIN = -4.27;
const START_LANE_WIDTH = 1.22;
const INSIDE_SAFE_LIMIT = TRACK_HALF_WIDTH - 1.28;
const OUTSIDE_SAFE_LIMIT = -TRACK_HALF_WIDTH + 1.2;

const PREFERRED_LINES = [3.8, 2.1, 3.25, 1.1, 4.15, 0.55, 2.65, 1.6] as const;

export interface RacingLineHorse {
  readonly horseNumber: number;
  readonly progress: number;
  readonly rank: number;
  readonly speed: number;
  readonly laneIndex: number;
  readonly lateralOffset: number;
}

export function finishLineOffset(position: number, fieldSize: number): number {
  const safeFieldSize = Math.max(1, Math.round(fieldSize));
  const safePosition = THREE.MathUtils.clamp(Math.round(position), 1, safeFieldSize);
  const centeredPosition = safePosition - (safeFieldSize + 1) / 2;
  return THREE.MathUtils.clamp(centeredPosition * 0.95, -4.6, 4.6);
}

export function racingLineOffset(
  horse: RacingLineHorse,
  field: readonly RacingLineHorse[],
  distanceM = 1_200,
): number {
  const startLane = START_LANE_ORIGIN + horse.laneIndex * START_LANE_WIDTH;
  const merge = smootherstep(normalize(horse.progress, 0.018, 0.17));
  if (merge <= 0) return startLane;

  const averageSpeed =
    field.reduce((total, candidate) => total + candidate.speed, 0) / Math.max(1, field.length);
  const speedAdvantage = THREE.MathUtils.clamp((horse.speed - averageSpeed) / 2.8, -1, 1);
  const nearestAhead = field
    .filter(
      (candidate) =>
        candidate.horseNumber !== horse.horseNumber && candidate.progress > horse.progress,
    )
    .reduce<RacingLineHorse | undefined>((nearest, candidate) => {
      if (nearest === undefined) return candidate;
      return candidate.progress < nearest.progress ? candidate : nearest;
    }, undefined);
  const gapAhead =
    nearestAhead === undefined ? Number.POSITIVE_INFINITY : nearestAhead.progress - horse.progress;
  const blocked = smootherstep(1 - normalize(gapAhead, 0.004, 0.019));

  const preferred = PREFERRED_LINES[horse.horseNumber - 1] ?? 2.2;
  const courseProgress = raceProgressToCourseProgress(horse.progress, 0, distanceM);
  const turnBias = courseTurnAmount(courseProgress, distanceM) * 0.68;
  const flowingDrift =
    Math.sin((horse.progress * 2.4 + horse.horseNumber * 0.173) * Math.PI * 2) * 0.32;
  const outsideMove =
    Math.max(0, speedAdvantage) * 0.72 + blocked * (0.9 + Math.max(0, speedAdvantage) * 0.55);
  const settleInside = Math.max(0, -speedAdvantage) * 0.18;

  let raceLine =
    preferred + turnBias + flowingDrift - outsideMove + settleInside + horse.lateralOffset * 0.35;

  raceLine = THREE.MathUtils.clamp(raceLine, OUTSIDE_SAFE_LIMIT, INSIDE_SAFE_LIMIT);

  return THREE.MathUtils.lerp(startLane, raceLine, merge);
}

function normalize(value: number, start: number, end: number): number {
  return THREE.MathUtils.clamp((value - start) / (end - start), 0, 1);
}

function smootherstep(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}
