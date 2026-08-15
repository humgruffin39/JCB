import type { TimelineFrameContract } from '@jcb/contracts';
import { describe, expect, it } from 'vitest';
import { RaceCameraBattleTracker } from './race-camera-battle.js';
import type { RaceWorldState } from './race-world-types.js';

describe('RaceCameraBattleTracker', () => {
  it('briefly focuses a nearby rival after a meaningful mid-race overtake', () => {
    const tracker = new RaceCameraBattleTracker(1_200);
    tracker.update(state(0, [horse(1, 1, 0.4), horse(2, 4, 0.39), horse(3, 2, 0.395)]), 0.4, true);

    const overtake = state(19_000, [horse(1, 1, 0.503), horse(2, 2, 0.501), horse(3, 3, 0.49)]);
    tracker.update(overtake, 0.51, false);
    expect(tracker.focusProgressFor(overtake)).toBeCloseTo(0.502);

    const expired = state(22_201, overtake.frame.horses);
    tracker.update(expired, 0.55, false);
    expect(tracker.focusProgressFor(expired)).toBeUndefined();
  });

  it('does not retain a cutaway for the photo finish', () => {
    const tracker = new RaceCameraBattleTracker(1_200);
    tracker.update(state(0, [horse(1, 2, 0.4), horse(2, 3, 0.39)]), 0.4, true);
    const photo = state(19_000, [horse(1, 1, 0.5), horse(2, 2, 0.499)], true);
    tracker.update(photo, 0.5, false);
    expect(tracker.focusProgressFor(photo)).toBeUndefined();
  });
});

function state(
  positionMs: number,
  horses: TimelineFrameContract['horses'],
  isPhoto = false,
): RaceWorldState {
  return {
    frame: { timeMs: positionMs, horses },
    positionMs,
    finishOrder: [],
    isPhoto,
  };
}

function horse(
  horseNumber: number,
  rank: number,
  progress: number,
): TimelineFrameContract['horses'][number] {
  return {
    horseNumber,
    progress,
    laneIndex: horseNumber - 1,
    lateralOffset: 0,
    rank,
    speed: 18,
    animationState: 'running',
  };
}
