import { COURSE_LENGTH, raceProgressToCourseProgress } from './race-course.js';

const HORSE_NOSE_OFFSET = 1.05;
const FINISH_ROOT_PROGRESS = raceProgressToCourseProgress(1, HORSE_NOSE_OFFSET);
export const MIN_VISUAL_FINISH_SPEED_MPS = 4;
const FINISH_POSITION_SETTLE_TOLERANCE_M = 0.25;

export const POST_FINISH_RUNOUT_DISTANCE_M = 32;
export const POST_FINISH_RUNOUT_MS = Math.ceil(
  (POST_FINISH_RUNOUT_DISTANCE_M / MIN_VISUAL_FINISH_SPEED_MPS) * 1_000,
);

export function postFinishCourseProgress(
  positionMs: number,
  visualFinishTimeMs: number,
  finishSpeedMps = 18,
  finishRootProgress = FINISH_ROOT_PROGRESS,
  courseLength = COURSE_LENGTH,
): number {
  const elapsedSeconds = Math.max(0, positionMs - visualFinishTimeMs) / 1_000;
  return (
    finishRootProgress +
    Math.min(POST_FINISH_RUNOUT_DISTANCE_M, elapsedSeconds * Math.max(0, finishSpeedMps)) /
      courseLength
  );
}

export function isPostFinishPoseReady(
  positionMs: number,
  visualFinishTimeMs: number,
  finishSpeedMps: number,
  displayedProgress: number,
  targetProgress: number,
  courseLength = COURSE_LENGTH,
): boolean {
  const targetStopped = hasReachedPostFinishStop(positionMs, visualFinishTimeMs, finishSpeedMps);
  const displayedDistanceFromTarget =
    Math.abs(displayedProgress - targetProgress) * Math.max(1, courseLength);
  return targetStopped && displayedDistanceFromTarget <= FINISH_POSITION_SETTLE_TOLERANCE_M;
}

function hasReachedPostFinishStop(
  positionMs: number,
  visualFinishTimeMs: number,
  finishSpeedMps: number,
): boolean {
  const speed = Math.max(0, finishSpeedMps);
  if (speed === 0) return true;
  const elapsedSeconds = Math.max(0, positionMs - visualFinishTimeMs) / 1_000;
  return elapsedSeconds * speed >= POST_FINISH_RUNOUT_DISTANCE_M;
}
