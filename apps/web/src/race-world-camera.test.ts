import type { TimelineFrameContract } from '@jcb/contracts';
import { describe, expect, it } from 'vitest';
import { selectCameraLeaderHorseNumber } from './race-world-camera.js';

describe('selectCameraLeaderHorseNumber', () => {
  it('uses official rank one even when progress ordering is temporarily different', () => {
    expect(selectCameraLeaderHorseNumber([horse(4, 2, 0.61), horse(7, 1, 0.6)])).toBe(7);
  });

  it('falls back deterministically when a partial frame has no rank one', () => {
    expect(
      selectCameraLeaderHorseNumber([horse(5, 3, 0.61), horse(2, 2, 0.61), horse(8, 4, 0.58)]),
    ).toBe(2);
    expect(selectCameraLeaderHorseNumber([])).toBeUndefined();
  });
});

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
