import * as THREE from 'three';
import { FINISHING_BLEND_DURATION_MS, poseHorse, type HorseRig } from './race-horse-model.js';
import { racingLineOffset } from './race-lines.js';
import {
  courseLengthForDistance,
  raceProgressToCourseProgress,
  sampleCourseWithRunout,
} from './race-course.js';
import {
  isPostFinishPoseReady,
  MIN_VISUAL_FINISH_SPEED_MPS,
  postFinishCourseProgress,
} from './race-world-finish.js';
import type { RaceWorldState } from './race-world-types.js';

const HORSE_NOSE_OFFSET = 1.05;

export interface AnimatedRaceHorse {
  readonly rig: HorseRig;
  initialized: boolean;
  courseProgress: number;
  lateralOffset: number;
  y: number;
  visualFinishTimeMs: number | undefined;
  visualFinishSpeedMps: number | undefined;
  finishingElapsedMs: number;
  previousFrameCourseProgress: number | undefined;
  previousFramePositionMs: number | undefined;
  visualCourseSpeedMps: number | undefined;
}

export interface RaceHorseFieldUpdate {
  readonly leaderProgress: number;
  readonly hasFinisher: boolean;
}

type FrameHorse = RaceWorldState['frame']['horses'][number];

export class RaceHorseField {
  readonly horses: readonly AnimatedRaceHorse[];
  private readonly frameHorseByNumber: Array<FrameHorse | undefined> = Array.from({ length: 9 });
  private readonly courseLength: number;
  private readonly finishRootProgress: number;

  constructor(
    rigs: readonly HorseRig[],
    private readonly distanceM: number,
  ) {
    this.courseLength = courseLengthForDistance(distanceM);
    this.finishRootProgress = raceProgressToCourseProgress(1, HORSE_NOSE_OFFSET, distanceM);
    this.horses = rigs.map((rig) => ({
      rig,
      initialized: false,
      courseProgress: 0,
      lateralOffset: 0,
      y: 0,
      visualFinishTimeMs: undefined,
      visualFinishSpeedMps: undefined,
      finishingElapsedMs: 0,
      previousFrameCourseProgress: undefined,
      previousFramePositionMs: undefined,
      visualCourseSpeedMps: undefined,
    }));
  }

  update(
    state: RaceWorldState,
    rewound: boolean,
    snap: boolean,
    deltaSeconds: number,
  ): RaceHorseFieldUpdate {
    this.frameHorseByNumber.fill(undefined);
    let leaderProgress = Number.NEGATIVE_INFINITY;
    let hasFinisher = false;
    for (const frameHorse of state.frame.horses) {
      this.frameHorseByNumber[frameHorse.horseNumber] = frameHorse;
      leaderProgress = Math.max(leaderProgress, frameHorse.progress);
      hasFinisher ||= frameHorse.progress >= 1;
    }

    for (const horse of this.horses) {
      if (rewound) resetFinishState(horse);
      const frameHorse = this.frameHorseByNumber[horse.rig.horseNumber];
      if (frameHorse === undefined) continue;
      this.updateHorse(horse, frameHorse, state, snap, deltaSeconds);
    }

    return {
      leaderProgress: Number.isFinite(leaderProgress) ? leaderProgress : 0,
      hasFinisher,
    };
  }

  dispose(scene: THREE.Scene): void {
    for (const horse of this.horses) {
      scene.remove(horse.rig.root);
      horse.rig.dispose();
    }
  }

  private updateHorse(
    horse: AnimatedRaceHorse,
    frameHorse: FrameHorse,
    state: RaceWorldState,
    snap: boolean,
    deltaSeconds: number,
  ): void {
    const frameCourseProgress = raceProgressToCourseProgress(
      frameHorse.progress,
      HORSE_NOSE_OFFSET,
      this.distanceM,
    );
    updateVisualSpeed(horse, frameHorse, frameCourseProgress, state.positionMs, this.courseLength);
    horse.previousFrameCourseProgress = frameCourseProgress;
    horse.previousFramePositionMs = state.positionMs;

    if (horse.visualFinishTimeMs === undefined && frameHorse.progress >= 1) {
      horse.visualFinishTimeMs = state.positionMs;
      horse.visualFinishSpeedMps = THREE.MathUtils.clamp(
        horse.visualCourseSpeedMps ?? 8.5,
        MIN_VISUAL_FINISH_SPEED_MPS,
        16,
      );
    }
    const targetProgress =
      horse.visualFinishTimeMs === undefined
        ? frameCourseProgress
        : postFinishCourseProgress(
            state.positionMs,
            horse.visualFinishTimeMs,
            horse.visualFinishSpeedMps ?? 8.5,
            this.finishRootProgress,
            this.courseLength,
          );
    const targetLateralOffset =
      state.isPhoto && horse.initialized
        ? horse.lateralOffset
        : racingLineOffset(frameHorse, state.frame.horses, this.distanceM);
    const hasCrossedFinish = horse.visualFinishTimeMs !== undefined || frameHorse.progress >= 1;
    const postFinishTimeMs = horse.visualFinishTimeMs ?? state.positionMs;
    const postFinishPoseReady =
      hasCrossedFinish &&
      isPostFinishPoseReady(
        state.positionMs,
        postFinishTimeMs,
        horse.visualFinishSpeedMps ?? 8.5,
        horse.courseProgress,
        targetProgress,
        this.courseLength,
      );
    horse.finishingElapsedMs = postFinishPoseReady
      ? Math.min(
          FINISHING_BLEND_DURATION_MS,
          horse.finishingElapsedMs + Math.max(0, deltaSeconds) * 1_000,
        )
      : 0;
    const poseState =
      frameHorse.animationState === 'waiting'
        ? 'waiting'
        : postFinishPoseReady
          ? 'finishing'
          : 'running';

    if (!horse.initialized || snap) {
      horse.courseProgress = targetProgress;
      horse.lateralOffset = targetLateralOffset;
      horse.y = 0.025;
      horse.initialized = true;
    } else {
      horse.courseProgress = THREE.MathUtils.damp(
        horse.courseProgress,
        targetProgress,
        16,
        deltaSeconds,
      );
      horse.lateralOffset = THREE.MathUtils.damp(
        horse.lateralOffset,
        targetLateralOffset,
        2.8,
        deltaSeconds,
      );
      horse.y = THREE.MathUtils.damp(horse.y, 0.025, 20, deltaSeconds);
    }
    const courseSample = sampleCourseWithRunout(
      horse.courseProgress,
      horse.lateralOffset,
      this.distanceM,
    );
    horse.rig.root.position.copy(courseSample.position);
    horse.rig.root.position.y = horse.y;
    horse.rig.root.rotation.y = courseSample.heading;
    const strideLean = THREE.MathUtils.clamp((frameHorse.speed - 17) * -0.012, -0.045, 0.025);
    horse.rig.root.rotation.z = THREE.MathUtils.damp(
      horse.rig.root.rotation.z,
      strideLean,
      7,
      deltaSeconds,
    );
    poseHorse(
      horse.rig,
      state.positionMs,
      frameHorse.speed,
      poseState,
      postFinishPoseReady ? horse.finishingElapsedMs : 0,
    );
  }
}

function resetFinishState(horse: AnimatedRaceHorse): void {
  horse.visualFinishTimeMs = undefined;
  horse.visualFinishSpeedMps = undefined;
  horse.finishingElapsedMs = 0;
  horse.previousFrameCourseProgress = undefined;
  horse.previousFramePositionMs = undefined;
  horse.visualCourseSpeedMps = undefined;
}

function updateVisualSpeed(
  horse: AnimatedRaceHorse,
  frameHorse: FrameHorse,
  frameCourseProgress: number,
  positionMs: number,
  courseLength: number,
): void {
  if (
    horse.previousFrameCourseProgress === undefined ||
    horse.previousFramePositionMs === undefined ||
    positionMs <= horse.previousFramePositionMs ||
    frameHorse.progress >= 0.9995
  ) {
    return;
  }
  const elapsedSeconds = (positionMs - horse.previousFramePositionMs) / 1_000;
  const measuredSpeedMps =
    ((frameCourseProgress - horse.previousFrameCourseProgress) * courseLength) / elapsedSeconds;
  if (!Number.isFinite(measuredSpeedMps) || measuredSpeedMps <= 0) return;
  horse.visualCourseSpeedMps =
    horse.visualCourseSpeedMps === undefined
      ? measuredSpeedMps
      : THREE.MathUtils.damp(horse.visualCourseSpeedMps, measuredSpeedMps, 10, elapsedSeconds);
}
