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
const DRAMA_FADE = 0.5;
const DRAMA_END = 0.8;

/**
 * The official timeline and result remain untouched. This function only time-warps the
 * frame shown by the race viewer, and returns to the official timeline before the photo.
 */
export function createRaceDramaFrame(
  frames: readonly TimelineFrame[],
  positionMs: number,
  finishOrder: readonly RaceDramaFinish[],
  timelineDurationMs?: number,
): TimelineFrame {
  if (frames.length < 2) return interpolateTimelineFrame(frames, positionMs);

  const durationMs = Math.max(frames.at(-1)!.timeMs, timelineDurationMs ?? frames.at(-1)!.timeMs);
  const officialFrame = extendFinalTimelineFrame(
    interpolateTimelineFrame(frames, positionMs),
    frames.at(-1)!,
    positionMs,
    finishOrder,
  );
  if (durationMs <= 0 || positionMs <= 0) return officialFrame;
  if (positionMs >= durationMs) return applyFinishOrder(officialFrame, finishOrder);

  const phase = clamp01(positionMs / durationMs);
  const finishByHorse = new Map(finishOrder.map((finish) => [finish.horseNumber, finish]));
  const finishPositions = new Map(
    finishOrder.map((finish) => [finish.horseNumber, finish.position]),
  );
  const horses = officialFrame.horses.map((horse) => {
    const timeShiftMs = cinematicTimeShift(phase, durationMs, horse.horseNumber);
    const sampleTimeMs = clamp(positionMs + timeShiftMs, 0, durationMs);
    const sampled =
      extendFinalTimelineHorse(
        interpolateTimelineHorse(frames, sampleTimeMs, horse.horseNumber) ?? horse,
        frames.at(-1)!.timeMs,
        sampleTimeMs,
        finishByHorse.get(horse.horseNumber),
      ) ?? horse;
    const finish = finishByHorse.get(horse.horseNumber);
    const officiallyFinished = finish !== undefined && positionMs >= finish.finishTimeMs;
    const progress = officiallyFinished ? 1 : Math.min(sampled.progress, 0.999999);
    const animationState = officiallyFinished
      ? ('finished' as const)
      : sampled.animationState === 'finished'
        ? ('running' as const)
        : sampled.animationState;
    const timeShiftDerivative = cinematicTimeShiftDerivative(phase, durationMs, horse.horseNumber);
    const playbackRate = clamp(1 + timeShiftDerivative, 0.92, 1.12);
    return {
      ...sampled,
      progress,
      animationState,
      speed: sampled.speed * playbackRate,
    };
  });

  const rankedHorses = [
    ...horses
      .filter((horse) => horse.progress >= 1)
      .sort(
        (left, right) =>
          (finishPositions.get(left.horseNumber) ?? Number.POSITIVE_INFINITY) -
            (finishPositions.get(right.horseNumber) ?? Number.POSITIVE_INFINITY) ||
          left.horseNumber - right.horseNumber,
      ),
    ...horses
      .filter((horse) => horse.progress < 1)
      .sort(
        (left, right) =>
          right.progress - left.progress ||
          right.speed - left.speed ||
          left.horseNumber - right.horseNumber,
      ),
  ];
  const ranks = new Map(rankedHorses.map((horse, index) => [horse.horseNumber, index + 1]));

  return {
    timeMs: Math.round(positionMs),
    horses: horses.map((horse) => ({
      ...horse,
      rank: ranks.get(horse.horseNumber) ?? horse.rank,
    })),
  };
}

function extendFinalTimelineFrame(
  frame: TimelineFrame,
  lastFrame: TimelineFrame,
  positionMs: number,
  finishOrder: readonly RaceDramaFinish[],
): TimelineFrame {
  if (positionMs <= lastFrame.timeMs || finishOrder.length === 0) return frame;
  const finishByHorse = new Map(finishOrder.map((finish) => [finish.horseNumber, finish]));
  return {
    ...frame,
    horses: frame.horses.map((horse) =>
      extendFinalTimelineHorse(
        horse,
        lastFrame.timeMs,
        positionMs,
        finishByHorse.get(horse.horseNumber),
      ),
    ),
  };
}

function extendFinalTimelineHorse(
  horse: TimelineHorse,
  lastFrameTimeMs: number,
  positionMs: number,
  finish: RaceDramaFinish | undefined,
): TimelineHorse {
  if (finish === undefined || positionMs <= lastFrameTimeMs) return horse;
  const finishSpan = Math.max(1, finish.finishTimeMs - lastFrameTimeMs);
  const alpha = clamp01((positionMs - lastFrameTimeMs) / finishSpan);
  return {
    ...horse,
    progress: lerp(horse.progress, 1, alpha),
    animationState: alpha >= 1 ? ('finished' as const) : ('running' as const),
  };
}

function applyFinishOrder(
  frame: TimelineFrame,
  finishOrder: readonly RaceDramaFinish[],
): TimelineFrame {
  const positions = new Map(finishOrder.map((finish) => [finish.horseNumber, finish.position]));
  const horses = frame.horses.map((horse) => ({
    ...horse,
    progress: positions.has(horse.horseNumber) ? 1 : horse.progress,
    animationState: positions.has(horse.horseNumber) ? ('finished' as const) : horse.animationState,
  }));
  const ranks = new Map(
    [...horses]
      .sort(
        (left, right) =>
          (positions.get(left.horseNumber) ?? Number.POSITIVE_INFINITY) -
            (positions.get(right.horseNumber) ?? Number.POSITIVE_INFINITY) ||
          right.progress - left.progress ||
          left.horseNumber - right.horseNumber,
      )
      .map((horse, index) => [horse.horseNumber, index + 1]),
  );
  return {
    ...frame,
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

function cinematicTimeShift(phase: number, durationMs: number, horseNumber: number): number {
  const earlyEnvelope =
    smootherstep(normalize(phase, DRAMA_START, DRAMA_FULL)) *
    (1 - smootherstep(normalize(phase, DRAMA_FADE, DRAMA_END)));
  const signature = horseSignature(horseNumber);
  const primary = Math.sin((phase * signature.primaryCycles + signature.primaryPhase) * TAU);
  const secondary = Math.sin((phase * signature.secondaryCycles + signature.secondaryPhase) * TAU);
  const fieldShift =
    durationMs * signature.amplitude * 0.2 * earlyEnvelope * (primary * 0.72 + secondary * 0.28);
  return fieldShift;
}

function cinematicTimeShiftDerivative(
  phase: number,
  durationMs: number,
  horseNumber: number,
): number {
  const epsilon = 0.00025;
  const before = cinematicTimeShift(Math.max(0, phase - epsilon), durationMs, horseNumber);
  const after = cinematicTimeShift(Math.min(1, phase + epsilon), durationMs, horseNumber);
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
