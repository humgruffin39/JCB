import type { TimelineFrameContract } from '@jcb/contracts';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { HorseRig } from './race-horse-model.js';
import { RaceHorseField } from './race-world-horses.js';

describe('RaceHorseField', () => {
  it('indexes unordered frame entries and reports leader/finish state in one pass', () => {
    const dispose = vi.fn();
    const rig = createRig(4, dispose);
    const field = new RaceHorseField([rig], 1_200);
    const frame: TimelineFrameContract = {
      timeMs: 12_000,
      horses: [horse(2, 2, 0.58), horse(4, 1, 0.62), horse(8, 3, 1)],
    };

    const result = field.update(
      { frame, positionMs: 12_000, finishOrder: [], isPhoto: false },
      false,
      true,
      1 / 60,
    );

    expect(result).toEqual({ leaderProgress: 1, hasFinisher: true });
    expect(rig.root.position.length()).toBeGreaterThan(0);

    const scene = new THREE.Scene();
    scene.add(rig.root);
    field.dispose(scene);
    expect(scene.children).not.toContain(rig.root);
    expect(dispose).toHaveBeenCalledOnce();
  });
});

function createRig(horseNumber: number, dispose: () => void): HorseRig {
  const root = new THREE.Group();
  const mixer = new THREE.AnimationMixer(root);
  const idle = mixer.clipAction(new THREE.AnimationClip('idle', 1, []));
  const gallop = mixer.clipAction(new THREE.AnimationClip('gallop', 1, []));
  return {
    horseNumber,
    root,
    mixer,
    idle,
    gallop,
    phaseOffset: 0,
    gallopTime: 0,
    lastPosePositionMs: undefined,
    dispose,
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
    animationState: progress >= 1 ? 'finished' : 'running',
  };
}
