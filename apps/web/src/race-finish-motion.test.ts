import { describe, expect, it } from 'vitest';
import { COURSE_LENGTH, raceProgressToCourseProgress } from './race-course.js';
import {
  isPostFinishPoseReady,
  POST_FINISH_RUNOUT_DISTANCE_M,
  postFinishCourseProgress,
} from './race-world.js';

describe('race finish motion', () => {
  it('continues from the visible finish crossing instead of the official timestamp', () => {
    const visualFinishTimeMs = 118_750;
    const beforeCrossing = raceProgressToCourseProgress(0.9999, 1.05);
    const atCrossing = postFinishCourseProgress(visualFinishTimeMs, visualFinishTimeMs);
    const nextFrame = postFinishCourseProgress(visualFinishTimeMs + 50, visualFinishTimeMs, 19.4);

    expect((atCrossing - beforeCrossing) * COURSE_LENGTH).toBeLessThan(0.1);
    expect(nextFrame).toBeGreaterThan(atCrossing);
    expect((nextFrame - atCrossing) * COURSE_LENGTH).toBeCloseTo(0.97, 3);
  });

  it('never jumps forward when the visual crossing is still in the future', () => {
    expect(postFinishCourseProgress(110_000, 111_000)).toBe(
      postFinishCourseProgress(111_000, 111_000),
    );
  });

  it('keeps the previous runout distance before the camera enters the photo phase', () => {
    const finishTimeMs = 100_000;
    const stopped = postFinishCourseProgress(101_500, finishTimeMs, 12);

    expect(
      (stopped - postFinishCourseProgress(finishTimeMs, finishTimeMs, 12)) * COURSE_LENGTH,
    ).toBeCloseTo(18, 8);
  });

  it('keeps the gallop active until the displayed horse reaches the runout stop', () => {
    const finishTimeMs = 100_000;
    const finishSpeedMps = 12;
    const runoutStopTimeMs =
      finishTimeMs + (POST_FINISH_RUNOUT_DISTANCE_M / finishSpeedMps) * 1_000;
    const beforeStop = postFinishCourseProgress(
      runoutStopTimeMs - 500,
      finishTimeMs,
      finishSpeedMps,
    );
    const atStop = postFinishCourseProgress(runoutStopTimeMs, finishTimeMs, finishSpeedMps);

    expect(
      isPostFinishPoseReady(
        runoutStopTimeMs - 500,
        finishTimeMs,
        finishSpeedMps,
        beforeStop,
        beforeStop,
      ),
    ).toBe(false);
    expect(
      isPostFinishPoseReady(runoutStopTimeMs, finishTimeMs, finishSpeedMps, atStop, atStop),
    ).toBe(true);
    expect(
      isPostFinishPoseReady(runoutStopTimeMs, finishTimeMs, finishSpeedMps, atStop - 0.001, atStop),
    ).toBe(false);
    expect(
      isPostFinishPoseReady(
        finishTimeMs,
        finishTimeMs,
        finishSpeedMps,
        atStop,
        atStop,
        COURSE_LENGTH,
        true,
      ),
    ).toBe(true);
  });
});
