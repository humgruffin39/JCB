import * as THREE from 'three';
import { getFinishCameraShot } from './race-camera-director.js';
import {
  courseLengthForDistance,
  raceProgressToCourseProgress,
  sampleCourse,
  sampleCourseWithRunout,
} from './race-course.js';
import { RaceEnvironment, type RaceSurface } from './race-environment.js';
import {
  createHorseRig,
  FINISHING_BLEND_DURATION_MS,
  loadHorseAssets,
  poseHorse,
  type HorseCoatColor,
  type HorseRig,
} from './race-horse-model.js';
import { racingLineOffset } from './race-lines.js';
import {
  isPostFinishPoseReady,
  MIN_VISUAL_FINISH_SPEED_MPS,
  postFinishCourseProgress,
} from './race-world-finish.js';
import type { RaceCameraMode, RaceWorldState } from './race-world-types.js';
import { calculateFinishSnapshotCamera, readRenderTargetDataUrl } from './race-world-snapshot.js';
import { RaceWorldCameraController } from './race-world-camera.js';
import { createRaceWorldScene } from './race-world-scene.js';

export type {
  FinishPosition,
  FinishSnapshotCamera,
  RaceCameraMode,
  RaceWorldState,
} from './race-world-types.js';
export {
  FINISH_CAMERA_DELAY_MS,
  finishCameraPositionMs,
  isPostFinishPoseReady,
  MIN_VISUAL_FINISH_SPEED_MPS,
  POST_FINISH_RUNOUT_DISTANCE_M,
  POST_FINISH_RUNOUT_MS,
  postFinishCourseProgress,
} from './race-world-finish.js';
export { calculateFinishSnapshotCamera } from './race-world-snapshot.js';

const HORSE_NOSE_OFFSET = 1.05;

interface AnimatedHorse {
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

export class RaceWorld {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly environment: RaceEnvironment;
  private readonly sky: THREE.Mesh;
  private readonly horses: readonly AnimatedHorse[];
  private readonly cameraController: RaceWorldCameraController;
  private readonly courseLength: number;
  private readonly finishRootProgress: number;
  private finishSnapshotDataUrl: string | undefined;
  private finishSnapshotAttempts = 0;
  private finishSnapshotFailed = false;
  private lastPositionMs = 0;

  private constructor(
    renderer: THREE.WebGLRenderer,
    environment: RaceEnvironment,
    rigs: readonly HorseRig[],
    private readonly distanceM: number,
    onCameraModeChange?: (mode: RaceCameraMode) => void,
    onTrackedHorseChange?: (horseNumber: number | undefined) => void,
    private readonly onFinishSnapshot?: (snapshot: string | undefined) => void,
    private readonly onFinishSnapshotError?: () => void,
  ) {
    this.renderer = renderer;
    this.environment = environment;
    const worldScene = createRaceWorldScene(renderer, environment);
    this.scene = worldScene.scene;
    this.camera = worldScene.camera;
    this.sky = worldScene.sky;
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
    this.cameraController = new RaceWorldCameraController(
      renderer,
      this.camera,
      worldScene.orbit,
      worldScene.sun,
      worldScene.sunTarget,
      distanceM,
      this.horses,
      onCameraModeChange,
      onTrackedHorseChange,
    );

    for (const horse of this.horses) this.scene.add(horse.rig.root);
  }

  static async create(
    canvas: HTMLCanvasElement,
    horseCoats: ReadonlyMap<number, HorseCoatColor>,
    distanceM: number,
    surface: RaceSurface,
    onCameraModeChange?: (mode: RaceCameraMode) => void,
    onTrackedHorseChange?: (horseNumber: number | undefined) => void,
    onFinishSnapshot?: (snapshot: string | undefined) => void,
    onFinishSnapshotError?: () => void,
  ): Promise<RaceWorld> {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));

    const rigs: HorseRig[] = [];
    let environment: RaceEnvironment | undefined;
    try {
      const assets = await loadHorseAssets(renderer);
      for (let index = 0; index < 8; index += 1) {
        rigs.push(createHorseRig(assets, index + 1, horseCoats.get(index + 1)));
      }
      environment = new RaceEnvironment(renderer, distanceM, surface);
      return new RaceWorld(
        renderer,
        environment,
        rigs,
        distanceM,
        onCameraModeChange,
        onTrackedHorseChange,
        onFinishSnapshot,
        onFinishSnapshotError,
      );
    } catch (error) {
      rigs.forEach((rig) => rig.dispose());
      environment?.dispose();
      renderer.dispose();
      throw error;
    }
  }

  setCameraMode(mode: RaceCameraMode): void {
    this.cameraController.setCameraMode(mode);
  }

  setTrackedHorse(horseNumber: number | undefined): void {
    this.cameraController.setTrackedHorse(horseNumber);
  }

  resize(width: number, height: number): void {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    this.renderer.setSize(safeWidth, safeHeight, false);
    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
  }

  update(state: RaceWorldState, deltaSeconds: number): void {
    const rewound = state.positionMs + 700 < this.lastPositionMs;
    const snap = rewound || !this.cameraController.initialized;
    this.lastPositionMs = state.positionMs;
    if (rewound && this.finishSnapshotDataUrl !== undefined) {
      this.finishSnapshotDataUrl = undefined;
      this.onFinishSnapshot?.(undefined);
    }
    if (rewound) {
      this.finishSnapshotAttempts = 0;
      this.finishSnapshotFailed = false;
    }
    this.environment.update(state.positionMs);

    const ranked = [...state.frame.horses].sort(
      (left, right) => right.progress - left.progress || left.rank - right.rank,
    );
    const leaderProgress = ranked[0]?.progress ?? 0;
    const focusRaceProgress = state.isPhoto ? 1 : Math.min(leaderProgress, 1);

    for (const horse of this.horses) {
      if (rewound) {
        horse.visualFinishTimeMs = undefined;
        horse.visualFinishSpeedMps = undefined;
        horse.finishingElapsedMs = 0;
        horse.previousFrameCourseProgress = undefined;
        horse.previousFramePositionMs = undefined;
        horse.visualCourseSpeedMps = undefined;
      }
      const frameHorse = state.frame.horses.find(
        (candidate) => candidate.horseNumber === horse.rig.horseNumber,
      );
      if (frameHorse === undefined) continue;
      const frameCourseProgress = raceProgressToCourseProgress(
        frameHorse.progress,
        HORSE_NOSE_OFFSET,
        this.distanceM,
      );
      if (
        horse.previousFrameCourseProgress !== undefined &&
        horse.previousFramePositionMs !== undefined &&
        state.positionMs > horse.previousFramePositionMs &&
        frameHorse.progress < 0.9995
      ) {
        const elapsedSeconds = (state.positionMs - horse.previousFramePositionMs) / 1_000;
        const measuredSpeedMps =
          ((frameCourseProgress - horse.previousFrameCourseProgress) * this.courseLength) /
          elapsedSeconds;
        if (Number.isFinite(measuredSpeedMps) && measuredSpeedMps > 0) {
          horse.visualCourseSpeedMps =
            horse.visualCourseSpeedMps === undefined
              ? measuredSpeedMps
              : THREE.MathUtils.damp(
                  horse.visualCourseSpeedMps,
                  measuredSpeedMps,
                  10,
                  elapsedSeconds,
                );
        }
      }
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
      let targetProgress = frameCourseProgress;
      if (horse.visualFinishTimeMs !== undefined) {
        targetProgress = postFinishCourseProgress(
          state.positionMs,
          horse.visualFinishTimeMs,
          horse.visualFinishSpeedMps ?? 8.5,
          this.finishRootProgress,
          this.courseLength,
        );
      }
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
      if (postFinishPoseReady) {
        horse.finishingElapsedMs = Math.min(
          FINISHING_BLEND_DURATION_MS,
          horse.finishingElapsedMs + Math.max(0, deltaSeconds) * 1_000,
        );
      } else {
        horse.finishingElapsedMs = 0;
      }
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

    if (
      !state.isPhoto &&
      !this.finishSnapshotFailed &&
      this.finishSnapshotDataUrl === undefined &&
      this.finishSnapshotAttempts < 3 &&
      state.frame.horses.some((horse) => horse.progress >= 1)
    ) {
      this.finishSnapshotAttempts += 1;
      const snapshot = this.captureFinishSnapshot();
      if (snapshot !== undefined) {
        this.finishSnapshotDataUrl = snapshot;
        this.onFinishSnapshot?.(snapshot);
      } else if (this.finishSnapshotAttempts >= 3) {
        this.finishSnapshotFailed = true;
        this.onFinishSnapshotError?.();
      }
    }

    this.cameraController.update(state, focusRaceProgress, rewound, snap, deltaSeconds);
    this.renderer.render(this.scene, this.camera);
  }

  private captureFinishSnapshot(): string | undefined {
    const shot = getFinishCameraShot();
    const finishLine = sampleCourse(
      raceProgressToCourseProgress(shot.anchorRaceProgress ?? 1, 0, this.distanceM),
      0,
      this.distanceM,
    );
    const snapshotCamera = calculateFinishSnapshotCamera(finishLine, this.camera.aspect, shot);
    const previousPosition = this.camera.position.clone();
    const previousQuaternion = this.camera.quaternion.clone();
    const previousFieldOfView = this.camera.fov;
    const previousRenderTarget = this.renderer.getRenderTarget();
    const drawingBufferSize = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(drawingBufferSize);
    const width = Math.max(1, Math.round(drawingBufferSize.x));
    const height = Math.max(1, Math.round(drawingBufferSize.y));
    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    renderTarget.texture.colorSpace = THREE.SRGBColorSpace;

    try {
      this.camera.position.copy(snapshotCamera.cameraPosition);
      this.camera.fov = snapshotCamera.fieldOfView;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(snapshotCamera.targetPosition);
      this.camera.updateMatrixWorld(true);
      this.renderer.setRenderTarget(renderTarget);
      this.renderer.render(this.scene, this.camera);
      return readRenderTargetDataUrl(this.renderer, renderTarget, width, height);
    } catch (error) {
      console.warn('Failed to capture the finish snapshot.', error);
      return undefined;
    } finally {
      this.renderer.setRenderTarget(previousRenderTarget);
      renderTarget.dispose();
      this.camera.position.copy(previousPosition);
      this.camera.quaternion.copy(previousQuaternion);
      this.camera.fov = previousFieldOfView;
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld(true);
    }
  }

  dispose(): void {
    for (const horse of this.horses) {
      this.scene.remove(horse.rig.root);
      horse.rig.dispose();
    }
    this.environment.dispose();
    this.cameraController.dispose();
    this.sky.geometry.dispose();
    const skyMaterials: readonly THREE.Material[] = Array.isArray(this.sky.material)
      ? this.sky.material
      : [this.sky.material];
    skyMaterials.forEach((material) => material.dispose());
    this.renderer.dispose();
  }
}
