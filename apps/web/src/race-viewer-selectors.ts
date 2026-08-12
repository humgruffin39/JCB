import type { TimelineFrameContract } from '@jcb/contracts';
import { createRaceDramaFrame, type RaceDramaFinish } from './race-drama.js';

export type TimelineFrame = TimelineFrameContract;
export type FinishOrder = RaceDramaFinish;
export type RaceEntryForViewerSelectors = Readonly<{
  readonly horseNumber: number;
}>;
export type OrderedHorse = Readonly<{
  readonly horseNumber: number;
  readonly rank: number;
  readonly progress: number;
}>;

export function selectTimelineFinishOrder(
  entries: readonly RaceEntryForViewerSelectors[],
  frames: readonly TimelineFrame[],
  duration: number,
): readonly FinishOrder[] {
  if (frames.length === 0) return [];
  const estimates = entries.map((entry) => {
    let finishTimeMs = duration;
    for (let index = 1; index < frames.length; index += 1) {
      const previousFrame = frames[index - 1]!;
      const nextFrame = frames[index]!;
      const previousHorse = previousFrame.horses.find(
        (horse) => horse.horseNumber === entry.horseNumber,
      );
      const nextHorse = nextFrame.horses.find((horse) => horse.horseNumber === entry.horseNumber);
      if (previousHorse === undefined || nextHorse === undefined || nextHorse.progress < 1)
        continue;
      const progressDelta = nextHorse.progress - previousHorse.progress;
      const fraction =
        progressDelta <= 0
          ? 1
          : Math.max(0, Math.min(1, (1 - previousHorse.progress) / progressDelta));
      finishTimeMs = previousFrame.timeMs + (nextFrame.timeMs - previousFrame.timeMs) * fraction;
      break;
    }
    return { horseNumber: entry.horseNumber, finishTimeMs };
  });
  return estimates
    .sort((left, right) => left.finishTimeMs - right.finishTimeMs)
    .map((horse, index) => ({ ...horse, position: index + 1 }));
}

export const getTimelineFinishOrder = selectTimelineFinishOrder;

export function selectFinalOrder(
  resultFinishOrder: readonly FinishOrder[] | undefined,
  timelineFinishOrder: readonly FinishOrder[],
): readonly FinishOrder[] {
  return resultFinishOrder ?? timelineFinishOrder;
}

export function selectCurrentFrame(
  frames: readonly TimelineFrame[],
  position: number,
  finalOrder: readonly FinishOrder[],
  duration: number,
): TimelineFrame | undefined {
  if (frames.length === 0) return undefined;
  return createRaceDramaFrame(frames, position, finalOrder, duration);
}

export function selectOrderedHorses(
  currentFrame: TimelineFrame | undefined,
): readonly OrderedHorse[] {
  return [...(currentFrame?.horses ?? [])].sort((left, right) => left.rank - right.rank);
}
