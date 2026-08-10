import type { TimelineFrameContract } from '@jcb/contracts';

type TimelineFrame = TimelineFrameContract;
type TimelineHorse = TimelineFrame['horses'][number];

export interface RaceDramaFinish {
  readonly horseNumber: number;
  readonly position: number;
  readonly finishTimeMs: number;
}

const TAU = Math.PI * 2;
const DRAMA_START = 0.055;
const DRAMA_FULL = 0.13;
const DRAMA_FADE = 0.76;
const DRAMA_END = 0.855;
const WINNER_STAGE_START = 0.76;
const FINAL_STRAIGHT_START = 0.855;
const WINNER_ATTACK_START = 0.875;
const WINNER_ATTACK_END = 0.955;
const FINAL_SPRINT_RATE = 0.12;

/**
 * The official timeline and result remain untouched. This function only time-warps the
 * frame shown by the race viewer, and returns to the official timeline before the photo.
 */
export function createRaceDramaFrame(
  frames: readonly TimelineFrame[],
  positionMs: number,
  finishOrder: readonly RaceDramaFinish[],
): TimelineFrame {
  const officialFrame = interpolateTimelineFrame(frames, positionMs);
  if (frames.length < 2) return officialFrame;

  const durationMs = frames.at(-1)!.timeMs;
  if (durationMs <= 0 || positionMs <= 0 || positionMs >= durationMs) return officialFrame;

  const phase = clamp01(positionMs / durationMs);
  const winner = finishOrder.find((finish) => finish.position === 1);
  const runnerUp = finishOrder.find((finish) => finish.position === 2);
  const horses = officialFrame.horses.map((horse) => {
    const timeShiftMs = cinematicTimeShift(phase, durationMs, horse.horseNumber, winner, runnerUp);
    const sampleTimeMs = clamp(positionMs + timeShiftMs, 0, durationMs);
    const sampled = interpolateTimelineHorse(frames, sampleTimeMs, horse.horseNumber) ?? horse;
    const playbackRate = clamp(
      1 + cinematicTimeShiftDerivative(phase, durationMs, horse.horseNumber, winner, runnerUp),
      0.92,
      1.12,
    );
    return {
      ...sampled,
      speed: sampled.speed * playbackRate,
    };
  });

  const ranks = new Map(
    [...horses]
      .sort(
        (left, right) =>
          right.progress - left.progress ||
          right.speed - left.speed ||
          left.horseNumber - right.horseNumber,
      )
      .map((horse, index) => [horse.horseNumber, index + 1]),
  );

  return {
    timeMs: Math.round(positionMs),
    horses: horses.map((horse) => ({
      ...horse,
      rank: ranks.get(horse.horseNumber) ?? horse.rank,
    })),
  };
}

export function interpolateTimelineFrame(
  frames: readonly TimelineFrame[],
  positionMs: number,
): TimelineFrame {
  if (frames.length === 0) throw new Error('Race timeline is empty.');
  if (frames.length === 1 || positionMs <= frames[0]!.timeMs) return frames[0]!;
  const lastFrame = frames.at(-1)!;
  if (positionMs >= lastFrame.timeMs) return lastFrame;

  const [before, after] = surroundingFrames(frames, positionMs);
  const span = Math.max(1, after.timeMs - before.timeMs);
  const alpha = clamp01((positionMs - before.timeMs) / span);
  return {
    timeMs: Math.round(positionMs),
    horses: before.horses.map((horse) => interpolateHorse(horse, after.horses, alpha)),
  };
}

function interpolateTimelineHorse(
  frames: readonly TimelineFrame[],
  positionMs: number,
  horseNumber: number,
): TimelineHorse | undefined {
  if (positionMs <= frames[0]!.timeMs) {
    return frames[0]!.horses.find((horse) => horse.horseNumber === horseNumber);
  }
  const lastFrame = frames.at(-1)!;
  if (positionMs >= lastFrame.timeMs) {
    return lastFrame.horses.find((horse) => horse.horseNumber === horseNumber);
  }
  const [before, after] = surroundingFrames(frames, positionMs);
  const horse = before.horses.find((candidate) => candidate.horseNumber === horseNumber);
  if (horse === undefined) return undefined;
  const span = Math.max(1, after.timeMs - before.timeMs);
  return interpolateHorse(horse, after.horses, clamp01((positionMs - before.timeMs) / span));
}

function surroundingFrames(
  frames: readonly TimelineFrame[],
  positionMs: number,
): readonly [TimelineFrame, TimelineFrame] {
  let lower = 0;
  let upper = frames.length - 1;
  while (lower + 1 < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (frames[middle]!.timeMs <= positionMs) lower = middle;
    else upper = middle;
  }
  return [frames[lower]!, frames[upper]!];
}

function interpolateHorse(
  horse: TimelineHorse,
  afterHorses: readonly TimelineHorse[],
  alpha: number,
): TimelineHorse {
  const next = afterHorses.find((candidate) => candidate.horseNumber === horse.horseNumber);
  if (next === undefined) return horse;
  return {
    horseNumber: horse.horseNumber,
    progress: lerp(horse.progress, next.progress, alpha),
    laneIndex: alpha < 0.5 ? horse.laneIndex : next.laneIndex,
    lateralOffset: lerp(horse.lateralOffset, next.lateralOffset, alpha),
    rank: alpha < 0.5 ? horse.rank : next.rank,
    speed: lerp(horse.speed, next.speed, alpha),
    animationState: alpha < 0.5 ? horse.animationState : next.animationState,
  };
}

function cinematicTimeShift(
  phase: number,
  durationMs: number,
  horseNumber: number,
  winner: RaceDramaFinish | undefined,
  runnerUp: RaceDramaFinish | undefined,
): number {
  const earlyEnvelope =
    smootherstep(normalize(phase, DRAMA_START, DRAMA_FULL)) *
    (1 - smootherstep(normalize(phase, DRAMA_FADE, DRAMA_END)));
  const signature = horseSignature(horseNumber);
  const primary = Math.sin((phase * signature.primaryCycles + signature.primaryPhase) * TAU);
  const secondary = Math.sin((phase * signature.secondaryCycles + signature.secondaryPhase) * TAU);
  const fieldShift =
    durationMs * signature.amplitude * earlyEnvelope * (primary * 0.72 + secondary * 0.28);

  const finalSprint = finalSprintTimeShift(phase, durationMs);
  if (winner === undefined || runnerUp === undefined) return fieldShift + finalSprint;
  if (horseNumber !== winner.horseNumber) return fieldShift + finalSprint;

  const officialGapMs = Math.max(0, runnerUp.finishTimeMs - winner.finishTimeMs);
  const stagingDelayMs = Math.min(durationMs * 0.035, officialGapMs * 1.1 + 300);
  const stagedBehind =
    -stagingDelayMs * smootherstep(normalize(phase, WINNER_STAGE_START, FINAL_STRAIGHT_START));
  const finishingAttack =
    stagingDelayMs * smootherstep(normalize(phase, WINNER_ATTACK_START, WINNER_ATTACK_END));
  return fieldShift + finalSprint + stagedBehind + finishingAttack;
}

function finalSprintTimeShift(phase: number, durationMs: number): number {
  const sprintReserveMs = durationMs * (1 - FINAL_STRAIGHT_START) * FINAL_SPRINT_RATE;
  if (phase < FINAL_STRAIGHT_START) {
    return -sprintReserveMs * smootherstep(normalize(phase, DRAMA_FADE, FINAL_STRAIGHT_START));
  }
  return -sprintReserveMs + (phase - FINAL_STRAIGHT_START) * durationMs * FINAL_SPRINT_RATE;
}

function cinematicTimeShiftDerivative(
  phase: number,
  durationMs: number,
  horseNumber: number,
  winner: RaceDramaFinish | undefined,
  runnerUp: RaceDramaFinish | undefined,
): number {
  const epsilon = 0.00025;
  const before = cinematicTimeShift(
    Math.max(0, phase - epsilon),
    durationMs,
    horseNumber,
    winner,
    runnerUp,
  );
  const after = cinematicTimeShift(
    Math.min(1, phase + epsilon),
    durationMs,
    horseNumber,
    winner,
    runnerUp,
  );
  return (
    (after - before) /
    (Math.max(epsilon, Math.min(1, phase + epsilon) - Math.max(0, phase - epsilon)) * durationMs)
  );
}

function horseSignature(horseNumber: number): {
  readonly amplitude: number;
  readonly primaryCycles: number;
  readonly primaryPhase: number;
  readonly secondaryCycles: number;
  readonly secondaryPhase: number;
} {
  const seed = Math.max(1, horseNumber);
  return {
    amplitude: 0.014 + ((seed * 7) % 5) * 0.00075,
    primaryCycles: 2.05 + ((seed * 5) % 4) * 0.13,
    primaryPhase: fractional(seed * 0.271),
    secondaryCycles: 3.4 + ((seed * 3) % 5) * 0.16,
    secondaryPhase: fractional(seed * 0.419 + 0.17),
  };
}

function normalize(value: number, start: number, end: number): number {
  return clamp01((value - start) / Math.max(Number.EPSILON, end - start));
}

function smootherstep(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function fractional(value: number): number {
  return value - Math.floor(value);
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
