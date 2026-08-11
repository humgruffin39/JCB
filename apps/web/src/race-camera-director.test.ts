import { describe, expect, it } from 'vitest';
import { getBattleCameraShot, selectBroadcastCameraShot } from './race-camera-director.js';

describe('race camera director', () => {
  it('covers the full race with a deliberate broadcast sequence', () => {
    const checkpoints = [0, 0.04, 0.12, 0.25, 0.36, 0.5, 0.6, 0.7, 0.82, 0.9, 0.98, 1];
    expect(checkpoints.map((progress) => selectBroadcastCameraShot(progress, false).id)).toEqual([
      'break',
      'launch-track',
      'first-turn-tower',
      'turn-exit',
      'backstretch-track',
      'rear-quarter',
      'backstretch-tower',
      'far-turn-head-on',
      'final-turn-track',
      'home-stretch-track',
      'home-stretch-track',
      'finish-line',
    ]);
  });

  it('uses the finish-line camera for the photo state at any progress', () => {
    const shot = selectBroadcastCameraShot(0.4, true);
    expect(shot.id).toBe('finish-line');
    expect(shot.tangentOffset).toBe(0);
    expect(shot.normalOffset).toBeLessThan(0);
    expect(shot.height).toBeLessThan(4);
  });

  it('holds the home-stretch shot until the field is genuinely at the line', () => {
    expect(selectBroadcastCameraShot(0.945, false).id).toBe('home-stretch-track');
    expect(selectBroadcastCameraShot(0.9999, false).id).toBe('home-stretch-track');
    expect(selectBroadcastCameraShot(1, false).id).toBe('finish-line');
  });

  it('keeps every camera specification physically valid', () => {
    const shots = [
      ...Array.from({ length: 101 }, (_, index) => selectBroadcastCameraShot(index / 100, false)),
      getBattleCameraShot(),
    ];
    for (const shot of shots) {
      expect(shot.fieldOfView).toBeGreaterThanOrEqual(20);
      expect(shot.fieldOfView).toBeLessThanOrEqual(40);
      expect(shot.height).toBeGreaterThan(3);
      expect(shot.positionDamping).toBeGreaterThan(0);
      expect(shot.targetDamping).toBeGreaterThan(0);
      if (shot.movement === 'fixed') {
        expect(shot.anchorRaceProgress).toBeGreaterThanOrEqual(0);
        expect(shot.anchorRaceProgress).toBeLessThanOrEqual(1);
      }
    }
  });
});
