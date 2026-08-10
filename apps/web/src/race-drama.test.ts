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
    expect(createRaceDramaFrame(FRAMES, 0, FINISH_ORDER)).toEqual(FRAMES[0]);
    expect(createRaceDramaFrame(FRAMES, DURATION_MS, FINISH_ORDER)).toEqual(FRAMES.at(-1));
    expect(FINISH_ORDER).toEqual(officialResult);
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

  it('stages a close winner-runner-up duel only near the finish', () => {
    const winner = FINISH_ORDER[0]!;
    const runnerUp = FINISH_ORDER[1]!;
    let runnerLed = false;
    let winnerLedAfterward = false;
    let crossingGap = Number.POSITIVE_INFINITY;

    for (let phase = 0.88; phase <= 0.98; phase += 0.001) {
      const frame = createRaceDramaFrame(FRAMES, phase * DURATION_MS, FINISH_ORDER);
      const winnerHorse = findHorse(frame, winner.horseNumber);
      const runnerHorse = findHorse(frame, runnerUp.horseNumber);
      const gap = winnerHorse.progress - runnerHorse.progress;
      if (gap < 0) runnerLed = true;
      if (runnerLed && gap >= 0) {
        winnerLedAfterward = true;
        crossingGap = Math.min(crossingGap, Math.abs(gap));
      }
    }

    expect(runnerLed).toBe(true);
    expect(winnerLedAfterward).toBe(true);
    expect(crossingGap).toBeLessThan(0.0015);
  });

  it('accelerates the whole field on the final straight and only gives the winner extra pace', () => {
    const startMs = DURATION_MS * 0.9;
    const endMs = startMs + 300;
    const officialStart = interpolateTimelineFrame(FRAMES, startMs);
    const officialEnd = interpolateTimelineFrame(FRAMES, endMs);
    const dramaticStart = createRaceDramaFrame(FRAMES, startMs, FINISH_ORDER);
    const dramaticEnd = createRaceDramaFrame(FRAMES, endMs, FINISH_ORDER);
    const winnerNumber = FINISH_ORDER[0]!.horseNumber;
    const runnerNumber = FINISH_ORDER[1]!.horseNumber;

    const officialRunnerGain =
      findHorse(officialEnd, runnerNumber).progress -
      findHorse(officialStart, runnerNumber).progress;
    const dramaticRunnerGain =
      findHorse(dramaticEnd, runnerNumber).progress -
      findHorse(dramaticStart, runnerNumber).progress;
    const dramaticWinnerGain =
      findHorse(dramaticEnd, winnerNumber).progress -
      findHorse(dramaticStart, winnerNumber).progress;

    expect(dramaticRunnerGain).toBeGreaterThan(officialRunnerGain * 1.08);
    expect(dramaticWinnerGain).toBeGreaterThan(dramaticRunnerGain * 1.08);
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
