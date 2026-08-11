import type { TimelineFrameContract } from '@jcb/contracts';
import { describe, expect, it } from 'vitest';
import { createRaceDramaFrame, interpolateTimelineFrame } from './race-drama.js';

const DURATION_MS = 124_000;
const FINISH_TIMES = [118_100, 119_050, 120_500, 117_650, 121_250, 123_800, 122_400, 119_900];
const FRAMES = createTimeline();
const FINISH_ORDER = FINISH_TIMES.map((finishTimeMs, index) => ({
  horseNumber: index + 1,
  finishTimeMs,
}))
  .sort((left, right) => left.finishTimeMs - right.finishTimeMs)
  .map((finish, index) => ({ ...finish, position: index + 1 }));

describe('race drama', () => {
  it('preserves the untouched official start and finish frames', () => {
    const officialResult = structuredClone(FINISH_ORDER);
    const finalFrame = createRaceDramaFrame(FRAMES, DURATION_MS, FINISH_ORDER);
    expect(createRaceDramaFrame(FRAMES, 0, FINISH_ORDER)).toEqual(FRAMES[0]);
    expect(finalFrame.timeMs).toBe(FRAMES.at(-1)!.timeMs);
    expect([...finalFrame.horses].sort((left, right) => left.rank - right.rank)).toEqual(
      FINISH_ORDER.map((finish) => ({
        ...findHorse(finalFrame, finish.horseNumber),
        rank: finish.position,
        progress: 1,
        animationState: 'finished',
      })),
    );
    expect(FINISH_ORDER).toEqual(officialResult);
  });

  it('does not finish before the release duration when the final sample is early', () => {
    const truncatedFrames = FRAMES.slice(0, -1);
    const beforeReleaseEnd = createRaceDramaFrame(
      truncatedFrames,
      DURATION_MS - 250,
      FINISH_ORDER,
      DURATION_MS,
    );

    expect(beforeReleaseEnd.horses.some((horse) => horse.progress < 1)).toBe(true);
    expect(
      createRaceDramaFrame(truncatedFrames, DURATION_MS, FINISH_ORDER, DURATION_MS).horses.every(
        (horse) => horse.progress === 1,
      ),
    ).toBe(true);
  });

  it('keeps every horse moving forward while creating repeated mid-race order changes', () => {
    const previousProgress = new Map<number, number>();
    let previousOrder: readonly number[] | undefined;
    const recentOrders: (readonly number[])[] = [];
    let orderChanges = 0;
    let decisiveChanges = 0;

    for (let positionMs = 0; positionMs <= DURATION_MS; positionMs += 100) {
      const frame = createRaceDramaFrame(FRAMES, positionMs, FINISH_ORDER);
      for (const horse of frame.horses) {
        expect(horse.progress + 1e-9).toBeGreaterThanOrEqual(
          previousProgress.get(horse.horseNumber) ?? 0,
        );
        previousProgress.set(horse.horseNumber, horse.progress);
      }

      if (positionMs < DURATION_MS * 0.13 || positionMs > DURATION_MS * 0.78) continue;
      const order = [...frame.horses]
        .sort((left, right) => left.rank - right.rank)
        .map((horse) => horse.horseNumber);
      if (previousOrder !== undefined && order.join(',') !== previousOrder.join(',')) {
        orderChanges += 1;
      }
      const comparisonOrder = recentOrders.at(-20);
      if (
        comparisonOrder !== undefined &&
        order.some((horseNumber, index) => comparisonOrder.indexOf(horseNumber) - index >= 2)
      ) {
        decisiveChanges += 1;
      }
      recentOrders.push(order);
      previousOrder = order;
    }

    expect(orderChanges).toBeGreaterThanOrEqual(18);
    expect(decisiveChanges).toBeGreaterThanOrEqual(20);
  });

  it('keeps the final approach on the official timeline', () => {
    const startMs = DURATION_MS * 0.9;
    const endMs = startMs + 300;
    const officialStart = interpolateTimelineFrame(FRAMES, startMs);
    const officialEnd = interpolateTimelineFrame(FRAMES, endMs);
    const dramaticStart = createRaceDramaFrame(FRAMES, startMs, FINISH_ORDER);
    const dramaticEnd = createRaceDramaFrame(FRAMES, endMs, FINISH_ORDER);

    for (const horse of officialStart.horses) {
      expect(findHorse(dramaticStart, horse.horseNumber).progress).toBeCloseTo(horse.progress, 8);
      expect(findHorse(dramaticEnd, horse.horseNumber).progress).toBeCloseTo(
        findHorse(officialEnd, horse.horseNumber).progress,
        8,
      );
    }
  });

  it('keeps cinematic movement above a safe fraction of official pace', () => {
    let minimumRatio = Number.POSITIVE_INFINITY;
    for (let positionMs = 50; positionMs < DURATION_MS; positionMs += 50) {
      const previous = createRaceDramaFrame(FRAMES, positionMs - 50, FINISH_ORDER);
      const current = createRaceDramaFrame(FRAMES, positionMs, FINISH_ORDER);
      const officialPrevious = interpolateTimelineFrame(FRAMES, positionMs - 50);
      const officialCurrent = interpolateTimelineFrame(FRAMES, positionMs);
      for (const horse of current.horses) {
        const previousHorse = findHorse(previous, horse.horseNumber);
        const officialHorse = findHorse(officialCurrent, horse.horseNumber);
        const officialPreviousHorse = findHorse(officialPrevious, horse.horseNumber);
        const officialProgressDelta = officialHorse.progress - officialPreviousHorse.progress;
        if (officialProgressDelta <= 0 || officialHorse.progress >= 0.999) continue;
        minimumRatio = Math.min(
          minimumRatio,
          (horse.progress - previousHorse.progress) / officialProgressDelta,
        );
      }
    }

    expect(minimumRatio).toBeGreaterThanOrEqual(0.9);
  });

  it('locks horses that crossed the finish in official order', () => {
    for (let positionMs = 0; positionMs <= DURATION_MS; positionMs += 50) {
      const frame = createRaceDramaFrame(FRAMES, positionMs, FINISH_ORDER);
      const finished = frame.horses
        .filter((horse) => horse.progress >= 1)
        .sort((left, right) => left.rank - right.rank);
      const expected = FINISH_ORDER.filter((finish) =>
        finished.some((horse) => horse.horseNumber === finish.horseNumber),
      ).map((finish) => finish.horseNumber);

      expect(finished.map((horse) => horse.horseNumber)).toEqual(expected);
    }
  });
});

function createTimeline(): readonly TimelineFrameContract[] {
  const frames: TimelineFrameContract[] = [];
  for (let timeMs = 0; timeMs <= DURATION_MS; timeMs += 250) {
    const unfinished = FINISH_TIMES.map((finishTimeMs, index) => ({
      horseNumber: index + 1,
      progress: Math.min(1, timeMs / finishTimeMs),
      speed: timeMs === 0 ? 0 : finishTimeMs / 7_000,
    }));
    const ranks = new Map(
      [...unfinished]
        .sort((left, right) => right.progress - left.progress || right.speed - left.speed)
        .map((horse, index) => [horse.horseNumber, index + 1]),
    );
    frames.push({
      timeMs,
      horses: unfinished.map((horse) => ({
        horseNumber: horse.horseNumber,
        progress: horse.progress,
        laneIndex: horse.horseNumber - 1,
        lateralOffset: 0,
        rank: ranks.get(horse.horseNumber) ?? 8,
        speed: horse.speed,
        animationState: timeMs === 0 ? 'waiting' : horse.progress >= 1 ? 'finished' : 'running',
      })),
    });
  }
  return frames;
}

function findHorse(
  frame: TimelineFrameContract,
  horseNumber: number,
): TimelineFrameContract['horses'][number] {
  return frame.horses.find((horse) => horse.horseNumber === horseNumber)!;
}
