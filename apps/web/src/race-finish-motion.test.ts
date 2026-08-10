import { describe, expect, it } from 'vitest';
import { COURSE_LENGTH, raceProgressToCourseProgress } from './race-course.js';
import { postFinishCourseProgress } from './race-world.js';

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
});
