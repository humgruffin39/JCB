import { describe, expect, it } from 'vitest';
import { outerCoursePosition } from './race-environment.js';
import { gallopCadenceForSpeed, poseHorse, type HorseRig } from './race-horse-model.js';
import { sampleCourse, TRACK_HALF_WIDTH } from './race-course.js';
import * as THREE from 'three';

describe('race motion polish', () => {
  it('only changes the gallop cadence slightly across dramatic speed changes', () => {
    expect(gallopCadenceForSpeed(12)).toBeCloseTo(1.502, 3);
    expect(gallopCadenceForSpeed(18.5)).toBe(1.58);
    expect(gallopCadenceForSpeed(26)).toBe(1.67);
    expect(gallopCadenceForSpeed(26) - gallopCadenceForSpeed(12)).toBeLessThan(0.18);
  });

  it('keeps the gallop phase continuous when speed changes or the horse crosses the finish', () => {
    const root = new THREE.Group();
    const mixer = new THREE.AnimationMixer(root);
    const idle = mixer.clipAction(new THREE.AnimationClip('idle', 1, []));
    const gallop = mixer.clipAction(new THREE.AnimationClip('gallop', 1, []));
    const rig: HorseRig = {
      horseNumber: 1,
      root,
      mixer,
      idle,
      gallop,
      phaseOffset: 0,
      gallopTime: 0,
      lastPosePositionMs: undefined,
      dispose() {
        mixer.stopAllAction();
      },
    };

    poseHorse(rig, 10_000, 12, 'running');
    poseHorse(rig, 10_050, 26, 'running');
    const afterAcceleration = rig.gallopTime;
    poseHorse(rig, 10_100, 18, 'running');
    const afterFinish = rig.gallopTime;

    expect(afterAcceleration).toBeGreaterThan(0);
    expect(afterFinish).toBeGreaterThan(afterAcceleration);
    expect(afterFinish - afterAcceleration).toBeLessThan(0.09);
  });

  it('blends a finishing horse into a stopped idle pose', () => {
    const root = new THREE.Group();
    const mixer = new THREE.AnimationMixer(root);
    const idle = mixer.clipAction(new THREE.AnimationClip('idle', 1, []));
    const gallop = mixer.clipAction(new THREE.AnimationClip('gallop', 1, []));
    const rig: HorseRig = {
      horseNumber: 1,
      root,
      mixer,
      idle,
      gallop,
      phaseOffset: 0,
      gallopTime: 0,
      lastPosePositionMs: undefined,
      dispose() {
        mixer.stopAllAction();
      },
    };

    poseHorse(rig, 20_000, 18, 'finishing', 0);
    expect(rig.gallop.getEffectiveWeight()).toBe(1);
    expect(rig.idle.getEffectiveWeight()).toBe(0);

    poseHorse(rig, 20_500, 10, 'finishing', 500);
    expect(rig.gallop.getEffectiveWeight()).toBeLessThan(1);
    expect(rig.idle.getEffectiveWeight()).toBeGreaterThan(0);

    poseHorse(rig, 21_200, 0, 'finishing', 1_200);
    expect(rig.gallop.getEffectiveWeight()).toBe(0);
    expect(rig.idle.getEffectiveWeight()).toBe(1);
  });

  it('places every scenery tree beyond the outside rail', () => {
    for (let index = 0; index < 100; index += 1) {
      const progress = index / 100;
      const center = sampleCourse(progress, 0);
      const tree = outerCoursePosition(progress, 16);
      const signedOffset = tree.clone().sub(center.position).dot(center.normal);
      expect(signedOffset).toBeLessThan(-(TRACK_HALF_WIDTH + 15.9));
    }
  });
});
