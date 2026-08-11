import type { TimelineFrameContract } from '@jcb/contracts';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  getBattleCameraShot,
  getFinishCameraShot,
  selectBroadcastCameraShot,
  type BroadcastCameraShot,
  type BroadcastShotId,
} from './race-camera-director.js';
import {
  COURSE_LENGTH,
  courseLengthForDistance,
  raceProgressToCourseProgress,
  sampleCourse,
  sampleCourseWithRunout,
  type CourseSample,
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

const HORSE_NOSE_OFFSET = 1.05;
const FINISH_ROOT_PROGRESS = raceProgressToCourseProgress(1, HORSE_NOSE_OFFSET);
export const POST_FINISH_RUNOUT_DISTANCE_M = 32;
const MIN_VISUAL_FINISH_SPEED_MPS = 4;
export const POST_FINISH_RUNOUT_MS = Math.ceil(
  (POST_FINISH_RUNOUT_DISTANCE_M / MIN_VISUAL_FINISH_SPEED_MPS) * 1_000,
);
const FINISH_POSITION_SETTLE_TOLERANCE_M = 0.25;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export interface FinishPosition {
  readonly horseNumber: number;
  readonly position: number;
  readonly finishTimeMs: number;
}

export interface RaceWorldState {
  readonly frame: TimelineFrameContract;
  readonly positionMs: number;
  readonly finishOrder: readonly FinishPosition[];
  readonly isPhoto: boolean;
}

export type RaceCameraMode = 'follow' | 'horse';

export interface FinishSnapshotCamera {
  readonly cameraPosition: THREE.Vector3;
  readonly targetPosition: THREE.Vector3;
  readonly fieldOfView: number;
}

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
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(31, 1, 0.1, 800);
  private readonly environment: RaceEnvironment;
  private readonly sky: THREE.Mesh;
  private readonly orbit: OrbitControls;
  private readonly horses: readonly AnimatedHorse[];
  private readonly sun: THREE.DirectionalLight;
  private readonly sunTarget = new THREE.Object3D();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly courseLength: number;
  private readonly finishRootProgress: number;
  private cameraInitialized = false;
  private cameraMode: RaceCameraMode = 'follow';
  private readonly trackedFocus = new THREE.Vector3();
  private trackedHorseNumber: number | undefined;
  private leaderHorseNumber: number | undefined;
  private trackedCameraInitialized = false;
  private broadcastShotId: BroadcastShotId | undefined;
  private finishSnapshotDataUrl: string | undefined;
  private readonly previousRanks = new Map<number, number>();
  private battleHorseNumbers: readonly [number, number] | undefined;
  private battleUntilMs = 0;
  private lastBattleCutMs = Number.NEGATIVE_INFINITY;
  private pointerStart: { readonly id: number; readonly x: number; readonly y: number } | undefined;
  private lastPositionMs = 0;

  private constructor(
    renderer: THREE.WebGLRenderer,
    environment: RaceEnvironment,
    rigs: readonly HorseRig[],
    private readonly distanceM: number,
    private readonly onCameraModeChange?: (mode: RaceCameraMode) => void,
    private readonly onTrackedHorseChange?: (horseNumber: number | undefined) => void,
    private readonly onFinishSnapshot?: (snapshot: string | undefined) => void,
  ) {
    this.renderer = renderer;
    this.environment = environment;
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

    this.scene.background = new THREE.Color(0x94b8c9);
    this.scene.fog = new THREE.Fog(0xa7bfbe, 140, 620);
    this.sky = createSky();
    this.camera.add(this.sky);
    this.scene.add(this.camera, environment.group);

    this.orbit = new OrbitControls(this.camera, renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.enablePan = false;
    this.orbit.screenSpacePanning = true;
    this.orbit.minDistance = 5;
    this.orbit.maxDistance = 420;
    this.orbit.minPolarAngle = 0.12;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.zoomToCursor = true;
    this.orbit.addEventListener('start', this.handleOrbitStart);
    renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    renderer.domElement.addEventListener('pointercancel', this.handlePointerCancel);
    renderer.domElement.addEventListener('contextmenu', this.handleContextMenu);

    const hemisphere = new THREE.HemisphereLight(0xd7ecf1, 0x4c522e, 2.25);
    this.scene.add(hemisphere);
    this.sun = new THREE.DirectionalLight(0xfff2d2, 3.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -24;
    this.sun.shadow.camera.right = 24;
    this.sun.shadow.camera.top = 18;
    this.sun.shadow.camera.bottom = -12;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 90;
    this.sun.shadow.bias = -0.00035;
    this.sun.target = this.sunTarget;
    this.scene.add(this.sun, this.sunTarget);

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
      );
    } catch (error) {
      rigs.forEach((rig) => rig.dispose());
      environment?.dispose();
      renderer.dispose();
      throw error;
    }
  }

  setCameraMode(mode: RaceCameraMode): void {
    if (mode === this.cameraMode) return;
    if (mode !== 'horse' && this.trackedHorseNumber !== undefined) {
      this.trackedHorseNumber = undefined;
      this.trackedCameraInitialized = false;
      this.onTrackedHorseChange?.(undefined);
    }
    this.cameraMode = mode;
    if (mode === 'follow') {
      this.orbit.enablePan = false;
      this.cameraInitialized = false;
      this.broadcastShotId = undefined;
    } else {
      this.orbit.enablePan = false;
      this.trackedCameraInitialized = false;
    }
    this.onCameraModeChange?.(mode);
  }

  setTrackedHorse(horseNumber: number | undefined): void {
    if (horseNumber === undefined) {
      if (this.trackedHorseNumber === undefined) return;
      this.trackedHorseNumber = undefined;
      this.trackedCameraInitialized = false;
      this.onTrackedHorseChange?.(undefined);
      if (this.cameraMode === 'horse') this.setCameraMode('follow');
      return;
    }
    if (this.trackedHorseNumber === horseNumber && this.cameraMode === 'horse') return;
    this.trackedHorseNumber = horseNumber;
    this.trackedCameraInitialized = false;
    this.onTrackedHorseChange?.(horseNumber);
    this.setCameraMode('horse');
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
    const snap = rewound || !this.cameraInitialized;
    this.lastPositionMs = state.positionMs;
    if (rewound && this.finishSnapshotDataUrl !== undefined) {
      this.finishSnapshotDataUrl = undefined;
      this.onFinishSnapshot?.(undefined);
    }
    this.environment.update(state.positionMs);

    const ranked = [...state.frame.horses].sort(
      (left, right) => right.progress - left.progress || left.rank - right.rank,
    );
    this.leaderHorseNumber =
      state.frame.horses.find((horse) => horse.rank === 1)?.horseNumber ?? ranked[0]?.horseNumber;
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
      this.finishSnapshotDataUrl === undefined &&
      state.frame.horses.some((horse) => horse.progress >= 1)
    ) {
      const firstFinisher = this.horses
        .filter((horse) => horse.visualFinishTimeMs !== undefined)
        .sort(
          (left, right) =>
            (left.visualFinishTimeMs ?? Number.POSITIVE_INFINITY) -
            (right.visualFinishTimeMs ?? Number.POSITIVE_INFINITY),
        )[0];
      const snapshot = this.captureFinishSnapshot(firstFinisher);
      if (snapshot !== undefined) {
        this.finishSnapshotDataUrl = snapshot;
        this.onFinishSnapshot?.(snapshot);
      }
    }

    this.updateBattleSelection(state, focusRaceProgress, rewound);

    if (!state.isPhoto) {
      if (this.cameraMode === 'horse') {
        this.updateTrackedHorseCamera();
      } else {
        const battleProgress =
          focusRaceProgress >= 0.9 ? undefined : this.getBattleFocusProgress(state);
        this.updateCamera(
          battleProgress ?? focusRaceProgress,
          battleProgress !== undefined,
          snap,
          deltaSeconds,
        );
        this.orbit.target.copy(this.cameraTarget);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  private captureFinishSnapshot(firstFinisher?: AnimatedHorse): string | undefined {
    const shot = getFinishCameraShot();
    const finishLine = sampleCourse(
      raceProgressToCourseProgress(shot.anchorRaceProgress ?? 1, 0, this.distanceM),
      0,
      this.distanceM,
    );
    const snapshotCamera = calculateFinishSnapshotCamera(
      finishLine,
      this.horses
        .filter((horse) => horse.initialized)
        .sort((left, right) => right.courseProgress - left.courseProgress)
        .slice(0, 3)
        .map((horse) => horse.rig.root.position),
      this.camera.aspect,
      shot,
      firstFinisher?.rig.root.position,
    );
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
    this.orbit.removeEventListener('start', this.handleOrbitStart);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.handlePointerCancel);
    this.renderer.domElement.removeEventListener('contextmenu', this.handleContextMenu);
    this.orbit.dispose();
    this.sky.geometry.dispose();
    const skyMaterials: readonly THREE.Material[] = Array.isArray(this.sky.material)
      ? this.sky.material
      : [this.sky.material];
    skyMaterials.forEach((material) => material.dispose());
    this.renderer.dispose();
  }

  private updateCamera(
    focusRaceProgress: number,
    isBattle: boolean,
    snap: boolean,
    deltaSeconds: number,
  ): void {
    const shot = isBattle ? getBattleCameraShot() : selectBroadcastCameraShot(focusRaceProgress);
    const shotChanged = shot.id !== this.broadcastShotId;
    this.broadcastShotId = shot.id;
    const focus = sampleCourse(
      raceProgressToCourseProgress(focusRaceProgress, HORSE_NOSE_OFFSET, this.distanceM),
      0,
      this.distanceM,
    );
    const cameraOrigin =
      shot.movement === 'fixed'
        ? sampleCourse(
            raceProgressToCourseProgress(
              shot.anchorRaceProgress ?? focusRaceProgress,
              0,
              this.distanceM,
            ),
            0,
            this.distanceM,
          )
        : focus;
    const targetCamera = cameraOrigin.position
      .clone()
      .addScaledVector(cameraOrigin.tangent, shot.tangentOffset)
      .addScaledVector(cameraOrigin.normal, shot.normalOffset);
    targetCamera.y = shot.height;
    const targetLook = focus.position.clone().addScaledVector(focus.tangent, shot.lookAhead);
    targetLook.y = shot.lookHeight;
    const portraitCompensation = THREE.MathUtils.clamp(1.65 / this.camera.aspect, 1, 1.42);
    const targetFieldOfView = shot.fieldOfView * portraitCompensation;
    const shouldSnap = snap || shotChanged;

    if (shouldSnap) {
      this.camera.position.copy(targetCamera);
      this.cameraTarget.copy(targetLook);
      this.camera.fov = targetFieldOfView;
      this.camera.updateProjectionMatrix();
      this.cameraInitialized = true;
    } else {
      this.camera.position.x = THREE.MathUtils.damp(
        this.camera.position.x,
        targetCamera.x,
        shot.positionDamping,
        deltaSeconds,
      );
      this.camera.position.y = THREE.MathUtils.damp(
        this.camera.position.y,
        targetCamera.y,
        shot.positionDamping,
        deltaSeconds,
      );
      this.camera.position.z = THREE.MathUtils.damp(
        this.camera.position.z,
        targetCamera.z,
        shot.positionDamping,
        deltaSeconds,
      );
      this.cameraTarget.x = THREE.MathUtils.damp(
        this.cameraTarget.x,
        targetLook.x,
        shot.targetDamping,
        deltaSeconds,
      );
      this.cameraTarget.y = THREE.MathUtils.damp(
        this.cameraTarget.y,
        targetLook.y,
        shot.targetDamping,
        deltaSeconds,
      );
      this.cameraTarget.z = THREE.MathUtils.damp(
        this.cameraTarget.z,
        targetLook.z,
        shot.targetDamping,
        deltaSeconds,
      );
      const nextFieldOfView = THREE.MathUtils.damp(
        this.camera.fov,
        targetFieldOfView,
        shot.targetDamping,
        deltaSeconds,
      );
      if (Math.abs(nextFieldOfView - this.camera.fov) > 0.001) {
        this.camera.fov = nextFieldOfView;
        this.camera.updateProjectionMatrix();
      }
    }
    this.camera.up.copy(WORLD_UP);
    this.camera.lookAt(this.cameraTarget);

    this.updateSun(focus.position);
  }

  private updateBattleSelection(
    state: RaceWorldState,
    focusRaceProgress: number,
    rewound: boolean,
  ): void {
    if (rewound) {
      this.previousRanks.clear();
      this.battleHorseNumbers = undefined;
      this.battleUntilMs = 0;
      this.lastBattleCutMs = state.positionMs - 12_000;
    }

    let overtaker: (typeof state.frame.horses)[number] | undefined;
    let largestGain = 0;
    for (const horse of state.frame.horses) {
      const previousRank = this.previousRanks.get(horse.horseNumber);
      const gain = previousRank === undefined ? 0 : previousRank - horse.rank;
      if (gain > largestGain) {
        largestGain = gain;
        overtaker = horse;
      }
      this.previousRanks.set(horse.horseNumber, horse.rank);
    }

    if (
      overtaker !== undefined &&
      focusRaceProgress >= 0.35 &&
      focusRaceProgress <= 0.9 &&
      state.positionMs - this.lastBattleCutMs >= 18_000
    ) {
      const rival = state.frame.horses
        .filter((horse) => horse.horseNumber !== overtaker.horseNumber)
        .sort(
          (left, right) =>
            Math.abs(left.rank - overtaker.rank) - Math.abs(right.rank - overtaker.rank) ||
            Math.abs(left.progress - overtaker.progress) -
              Math.abs(right.progress - overtaker.progress),
        )[0];
      const gapMetres =
        rival === undefined
          ? Number.POSITIVE_INFINITY
          : Math.abs(rival.progress - overtaker.progress) * this.distanceM;
      if (rival !== undefined && gapMetres <= 6.5) {
        this.battleHorseNumbers = [overtaker.horseNumber, rival.horseNumber];
        this.battleUntilMs = state.positionMs + 3_200;
        this.lastBattleCutMs = state.positionMs;
      }
    }

    if (state.isPhoto || state.positionMs > this.battleUntilMs) {
      this.battleHorseNumbers = undefined;
    }
  }

  private getBattleFocusProgress(state: RaceWorldState): number | undefined {
    if (this.battleHorseNumbers === undefined || state.positionMs > this.battleUntilMs) {
      return undefined;
    }
    const battleHorses = this.battleHorseNumbers
      .map((horseNumber) => state.frame.horses.find((horse) => horse.horseNumber === horseNumber))
      .filter((horse): horse is (typeof state.frame.horses)[number] => horse !== undefined);
    if (battleHorses.length !== 2) return undefined;
    return (battleHorses[0]!.progress + battleHorses[1]!.progress) / 2;
  }

  private updateSun(focus: THREE.Vector3): void {
    this.sun.position.set(focus.x - 18, 36, focus.z + 24);
    this.sunTarget.position.set(focus.x + 8, 0, focus.z);
    this.sunTarget.updateMatrixWorld();
  }

  private readonly handleOrbitStart = (): void => {
    if (this.cameraMode === 'follow' && this.leaderHorseNumber !== undefined) {
      this.setTrackedHorse(this.leaderHorseNumber);
    }
  };

  private updateTrackedHorseCamera(): void {
    const trackedHorse = this.horses.find(
      (horse) => horse.rig.horseNumber === this.trackedHorseNumber && horse.initialized,
    );
    if (trackedHorse === undefined) {
      this.setCameraMode('follow');
      return;
    }
    const target = trackedHorse.rig.root.position.clone();
    target.y = 1.25;
    if (!this.trackedCameraInitialized) {
      this.camera.position.add(target.clone().sub(this.orbit.target));
      this.orbit.target.copy(target);
      this.trackedFocus.copy(target);
      this.trackedCameraInitialized = true;
    } else {
      const shift = target.clone().sub(this.trackedFocus);
      this.camera.position.add(shift);
      this.orbit.target.add(shift);
      this.trackedFocus.copy(target);
    }
    this.orbit.update();
    this.updateSun(trackedHorse.rig.root.position);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const start = this.pointerStart;
    this.pointerStart = undefined;
    if (start === undefined || start.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) return;
    const selectedHorse = this.pickHorse(event.clientX, event.clientY);
    if (selectedHorse !== undefined) this.setTrackedHorse(selectedHorse);
  };

  private pickHorse(clientX: number, clientY: number): number | undefined {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    let selectedHorse: number | undefined;
    let selectedDistance = Number.POSITIVE_INFINITY;
    for (const horse of this.horses) {
      const intersection = this.raycaster.intersectObject(horse.rig.root, true)[0];
      if (intersection !== undefined && intersection.distance < selectedDistance) {
        selectedHorse = horse.rig.horseNumber;
        selectedDistance = intersection.distance;
      }
    }
    return selectedHorse;
  }

  private readonly handlePointerCancel = (): void => {
    this.pointerStart = undefined;
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };
}

export function calculateFinishSnapshotCamera(
  finishLine: Pick<CourseSample, 'position' | 'tangent' | 'normal'>,
  horsePositions: readonly THREE.Vector3[],
  aspect: number,
  shot: BroadcastCameraShot = getFinishCameraShot(),
  fallbackHorsePosition?: THREE.Vector3,
): FinishSnapshotCamera {
  const tangent = finishLine.tangent.clone().normalize();
  const normal = finishLine.normal.clone().normalize();
  const validPositions = horsePositions.filter((position) =>
    [position.x, position.y, position.z].every(Number.isFinite),
  );
  const candidates = validPositions
    .toSorted(
      (left, right) =>
        right.clone().sub(finishLine.position).dot(tangent) -
        left.clone().sub(finishLine.position).dot(tangent),
    )
    .slice(0, 3);
  const fallback = fallbackHorsePosition ?? finishLine.position;
  const positions = candidates.length > 0 ? candidates : [fallback];
  const along = positions.map((position) => position.clone().sub(finishLine.position).dot(tangent));
  const across = positions.map((position) => position.clone().sub(finishLine.position).dot(normal));
  const minimumAlong = Math.min(...along);
  const maximumAlong = Math.max(...along);
  const centerAlong = (minimumAlong + maximumAlong) / 2;
  const centerAcross = across.reduce((sum, value) => sum + value, 0) / across.length;
  const targetPosition = finishLine.position
    .clone()
    .addScaledVector(tangent, centerAlong)
    .addScaledVector(normal, centerAcross);
  targetPosition.y = shot.lookHeight;

  const normalDistance = Math.max(10, Math.abs(shot.normalOffset));
  const framingMargin = 4.5;
  const halfWidth = Math.max(6, (maximumAlong - minimumAlong) / 2 + framingMargin);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const requiredFieldOfView =
    (2 * Math.atan(halfWidth / (normalDistance * safeAspect)) * 180) / Math.PI;
  const portraitCompensation = THREE.MathUtils.clamp(1.65 / safeAspect, 1, 1.42);
  const fieldOfView = THREE.MathUtils.clamp(
    Math.max(shot.fieldOfView * portraitCompensation, requiredFieldOfView),
    18,
    56,
  );
  const cameraPosition = finishLine.position
    .clone()
    .addScaledVector(tangent, centerAlong + shot.tangentOffset)
    .addScaledVector(normal, centerAcross + shot.normalOffset);
  cameraPosition.y = shot.height;
  return { cameraPosition, targetPosition, fieldOfView };
}

export function postFinishCourseProgress(
  positionMs: number,
  visualFinishTimeMs: number,
  finishSpeedMps = 18,
  finishRootProgress = FINISH_ROOT_PROGRESS,
  courseLength = COURSE_LENGTH,
): number {
  const elapsedSeconds = Math.max(0, positionMs - visualFinishTimeMs) / 1_000;
  return (
    finishRootProgress +
    Math.min(POST_FINISH_RUNOUT_DISTANCE_M, elapsedSeconds * Math.max(0, finishSpeedMps)) /
      courseLength
  );
}

export function isPostFinishPoseReady(
  positionMs: number,
  visualFinishTimeMs: number,
  finishSpeedMps: number,
  displayedProgress: number,
  targetProgress: number,
  courseLength = COURSE_LENGTH,
): boolean {
  const targetStopped = hasReachedPostFinishStop(positionMs, visualFinishTimeMs, finishSpeedMps);
  const displayedDistanceFromTarget =
    Math.abs(displayedProgress - targetProgress) * Math.max(1, courseLength);
  return targetStopped && displayedDistanceFromTarget <= FINISH_POSITION_SETTLE_TOLERANCE_M;
}

function hasReachedPostFinishStop(
  positionMs: number,
  visualFinishTimeMs: number,
  finishSpeedMps: number,
): boolean {
  const speed = Math.max(0, finishSpeedMps);
  if (speed === 0) return true;
  const elapsedSeconds = Math.max(0, positionMs - visualFinishTimeMs) / 1_000;
  return elapsedSeconds * speed >= POST_FINISH_RUNOUT_DISTANCE_M;
}

function readRenderTargetDataUrl(
  renderer: THREE.WebGLRenderer,
  renderTarget: THREE.WebGLRenderTarget,
  width: number,
  height: number,
): string | undefined {
  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels);
  const flippedPixels = new Uint8ClampedArray(pixels.length);
  const rowLength = width * 4;
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = (height - row - 1) * rowLength;
    const targetOffset = row * rowLength;
    flippedPixels.set(pixels.subarray(sourceOffset, sourceOffset + rowLength), targetOffset);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return undefined;
  const imageData = context.createImageData(width, height);
  imageData.data.set(flippedPixels);
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

function createSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(360, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x609abe) },
      horizonColor: { value: new THREE.Color(0xdbe5df) },
      bottomColor: { value: new THREE.Color(0x8ba67d) },
    },
    vertexShader: `
      varying vec3 vPosition;
      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      varying vec3 vPosition;
      void main() {
        float h = normalize(vPosition).y;
        vec3 color = h > 0.0
          ? mix(horizonColor, topColor, smoothstep(0.0, 0.72, h))
          : mix(horizonColor, bottomColor, smoothstep(0.0, -0.35, h));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geometry, material);
  sky.frustumCulled = false;
  return sky;
}
