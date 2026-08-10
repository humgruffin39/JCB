import { describe, expect, it } from 'vitest';
import {
  COURSE_LENGTH,
  COURSE_STRAIGHT_HALF_LENGTH,
  COURSE_TURN_RADIUS,
  RACE_FINISH_COURSE_PROGRESS,
  RACE_START_COURSE_PROGRESS,
  courseTurnAmount,
  raceProgressToCourseProgress,
  sampleCourse,
} from './race-course.js';

describe('stadium oval race course', () => {
  it('closes the course without a seam', () => {
    const start = sampleCourse(0);
    const end = sampleCourse(1);

    expect(start.position.distanceTo(end.position)).toBeLessThan(0.001);
    expect(start.tangent.distanceTo(end.tangent)).toBeLessThan(0.001);
  });

  it('uses two true straights joined by semicircular turns', () => {
    const bottomMiddle = sampleCourse(0);
    const topMiddle = sampleCourse(0.5);
    const rightTurnMiddleProgress =
      (COURSE_STRAIGHT_HALF_LENGTH + (Math.PI * COURSE_TURN_RADIUS) / 2) / COURSE_LENGTH;
    const rightTurnMiddle = sampleCourse(rightTurnMiddleProgress);

    expect(bottomMiddle.position.x).toBeCloseTo(0, 5);
    expect(bottomMiddle.position.z).toBeCloseTo(-COURSE_TURN_RADIUS, 5);
    expect(bottomMiddle.tangent.x).toBeCloseTo(1, 5);
    expect(topMiddle.position.x).toBeCloseTo(0, 5);
    expect(topMiddle.position.z).toBeCloseTo(COURSE_TURN_RADIUS, 5);
    expect(topMiddle.tangent.x).toBeCloseTo(-1, 5);
    expect(rightTurnMiddle.position.x).toBeCloseTo(
      COURSE_STRAIGHT_HALF_LENGTH + COURSE_TURN_RADIUS,
      5,
    );
    expect(rightTurnMiddle.position.z).toBeCloseTo(0, 5);
    expect(courseTurnAmount(0)).toBe(0);
    expect(courseTurnAmount(rightTurnMiddleProgress)).toBeCloseTo(1, 5);
  });

  it('keeps lane offsets perpendicular to the course direction', () => {
    for (const progress of [0, 0.125, 0.25, 0.5, 0.875]) {
      const center = sampleCourse(progress);
      const lane = sampleCourse(progress, 4.25);
      const displacement = lane.position.clone().sub(center.position);

      expect(displacement.length()).toBeCloseTo(4.25, 3);
      expect(Math.abs(displacement.dot(center.tangent))).toBeLessThan(0.001);
    }
  });

  it('maps the replay from the gate to the finish while accounting for the horse nose', () => {
    const noseOffset = 1.05;
    const correction = noseOffset / COURSE_LENGTH;

    expect(raceProgressToCourseProgress(0, noseOffset)).toBeCloseTo(
      RACE_START_COURSE_PROGRESS - correction,
      6,
    );
    expect(raceProgressToCourseProgress(1, noseOffset)).toBeCloseTo(
      RACE_FINISH_COURSE_PROGRESS - correction,
      6,
    );
  });
});
