import type { TimelineFrameContract } from '@jcb/contracts';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  getBattleCameraShot,
  selectBroadcastCameraShot,
  type BroadcastShotId,
} from './race-camera-director.js';
import { COURSE_LENGTH, raceProgressToCourseProgress, sampleCourse } from './race-course.js';
import { RaceEnvironment } from './race-environment.js';
import {
  createHorseRig,
  loadHorseAssets,
  poseHorse,
  type HorseCoatColor,
  type HorseRig,
} from './race-horse-model.js';
import { racingLineOffset } from './race-lines.js';

const HORSE_NOSE_OFFSET = 1.05;
const FINISH_ROOT_PROGRESS = raceProgressToCourseProgress(1, HORSE_NOSE_OFFSET);
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

export type RaceCameraMode = 'follow' | 'free' | 'horse';

interface AnimatedHorse {
  readonly rig: HorseRig;
  initialized: boolean;
  courseProgress: number;
  lateralOffset: number;
  y: number;
  visualFinishTimeMs: number | undefined;
  visualFinishSpeedMps: number | undefined;
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
  private cameraInitialized = false;
  private cameraMode: RaceCameraMode = 'follow';
  private readonly freeFocus = new THREE.Vector3();
  private readonly latestRenderedFocus = new THREE.Vector3();
  private readonly trackedFocus = new THREE.Vector3();
  private trackedHorseNumber: number | undefined;
  private trackedCameraInitialized = false;
  private broadcastShotId: BroadcastShotId | undefined;
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
    private readonly onCameraModeChange?: (mode: RaceCameraMode) => void,
    private readonly onTrackedHorseChange?: (horseNumber: number | undefined) => void,
  ) {
    this.renderer = renderer;
    this.environment = environment;
    this.horses = rigs.map((rig) => ({
      rig,
      initialized: false,
      courseProgress: 0,
      lateralOffset: 0,
      y: 0,
      visualFinishTimeMs: undefined,
      visualFinishSpeedMps: undefined,
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
    onCameraModeChange?: (mode: RaceCameraMode) => void,
    onTrackedHorseChange?: (horseNumber: number | undefined) => void,
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

    const [assets] = await Promise.all([loadHorseAssets(renderer)]);
    const rigs = Array.from({ length: 8 }, (_, index) =>
      createHorseRig(assets, index + 1, horseCoats.get(index + 1)),
    );
    return new RaceWorld(
      renderer,
      new RaceEnvironment(renderer),
      rigs,
      onCameraModeChange,
      onTrackedHorseChange,
    );
  }

  setCameraMode(mode: RaceCameraMode): void {
    if (mode === this.cameraMode) return;
    if (mode !== 'horse' && this.trackedHorseNumber !== undefined) {
      this.trackedHorseNumber = undefined;
      this.trackedCameraInitialized = false;
      this.onTrackedHorseChange?.(undefined);
    }
    this.cameraMode = mode;
    if (mode === 'free') {
      this.freeFocus.copy(this.latestRenderedFocus);
      this.orbit.target.copy(this.cameraTarget);
      this.orbit.enablePan = false;
      this.orbit.update();
    } else if (mode === 'follow') {
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
    const snap = rewound || state.isPhoto || !this.cameraInitialized;
    this.lastPositionMs = state.positionMs;
    this.environment.update(state.positionMs);

    const ranked = [...state.frame.horses].sort(
      (left, right) => right.progress - left.progress || left.rank - right.rank,
    );
    const weights = [4, 3, 2, 1] as const;
    const leaderProgress =
      ranked
        .slice(0, 4)
        .reduce((sum, horse, index) => sum + horse.progress * (weights[index] ?? 1), 0) /
      weights.reduce((sum, weight) => sum + weight, 0);
    const focusRaceProgress = state.isPhoto ? 1 : Math.min(leaderProgress, 1);
    const focusProgress = raceProgressToCourseProgress(focusRaceProgress, HORSE_NOSE_OFFSET);

    for (const horse of this.horses) {
      if (rewound) {
        horse.visualFinishTimeMs = undefined;
        horse.visualFinishSpeedMps = undefined;
        horse.previousFrameCourseProgress = undefined;
        horse.previousFramePositionMs = undefined;
        horse.visualCourseSpeedMps = undefined;
      }
      const frameHorse = state.frame.horses.find(
        (candidate) => candidate.horseNumber === horse.rig.horseNumber,
      );
      if (frameHorse === undefined) continue;
      const finish = state.finishOrder.find(
        (candidate) => candidate.horseNumber === frameHorse.horseNumber,
      );
      const frameCourseProgress = raceProgressToCourseProgress(
        frameHorse.progress,
        HORSE_NOSE_OFFSET,
      );
      if (
        horse.previousFrameCourseProgress !== undefined &&
        horse.previousFramePositionMs !== undefined &&
        state.positionMs > horse.previousFramePositionMs &&
        frameHorse.progress < 0.9995
      ) {
        const elapsedSeconds = (state.positionMs - horse.previousFramePositionMs) / 1_000;
        const measuredSpeedMps =
          ((frameCourseProgress - horse.previousFrameCourseProgress) * COURSE_LENGTH) /
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
      if (!state.isPhoto && horse.visualFinishTimeMs === undefined && frameHorse.progress >= 1) {
        horse.visualFinishTimeMs = state.positionMs;
        horse.visualFinishSpeedMps = THREE.MathUtils.clamp(
          horse.visualCourseSpeedMps ?? 8.5,
          4,
          16,
        );
      }
      let targetProgress = frameCourseProgress;
      if (state.isPhoto && finish !== undefined) {
        const winnerTime = state.finishOrder[0]?.finishTimeMs ?? finish.finishTimeMs;
        targetProgress =
          FINISH_ROOT_PROGRESS -
          Math.min(13, ((finish.finishTimeMs - winnerTime) / 1_000) * 12.5) / COURSE_LENGTH;
      } else if (horse.visualFinishTimeMs !== undefined) {
        targetProgress = postFinishCourseProgress(
          state.positionMs,
          horse.visualFinishTimeMs,
          horse.visualFinishSpeedMps ?? 8.5,
        );
      }
      const targetLateralOffset = racingLineOffset(frameHorse, state.frame.horses);
      const poseState =
        frameHorse.animationState === 'waiting' ? 'waiting' : state.isPhoto ? 'photo' : 'running';

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
      const courseSample = sampleCourse(horse.courseProgress, horse.lateralOffset);
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
      poseHorse(horse.rig, state.positionMs, frameHorse.speed, poseState);
    }

    // Every horse stays in this average, so changes in the live ranking cannot
    // cause a small camera jump when the fourth and fifth horses swap places.
    const fallbackFocus = sampleCourse(focusProgress).position;
    const renderedFocus = this.horses.reduce(
      (sum, horse) => sum.add(horse.initialized ? horse.rig.root.position : fallbackFocus),
      new THREE.Vector3(),
    );
    renderedFocus.multiplyScalar(1 / this.horses.length);
    this.latestRenderedFocus.copy(renderedFocus);
    this.updateBattleSelection(state, focusRaceProgress, rewound);

    if (this.cameraMode === 'free') {
      const shift = renderedFocus.clone().sub(this.freeFocus);
      this.camera.position.add(shift);
      this.orbit.target.add(shift);
      this.freeFocus.copy(renderedFocus);
      this.orbit.update();
      this.updateSun(renderedFocus);
    } else if (this.cameraMode === 'horse') {
      this.updateTrackedHorseCamera();
    } else {
      const battleProgress = this.getBattleFocusProgress(state);
      this.updateCamera(
        battleProgress ?? focusRaceProgress,
        state.isPhoto,
        battleProgress !== undefined,
        snap,
        deltaSeconds,
      );
      this.orbit.target.copy(this.cameraTarget);
    }
    this.renderer.render(this.scene, this.camera);
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
    isPhoto: boolean,
    isBattle: boolean,
    snap: boolean,
    deltaSeconds: number,
  ): void {
    const shot = isBattle
      ? getBattleCameraShot()
      : selectBroadcastCameraShot(focusRaceProgress, isPhoto);
    const shotChanged = shot.id !== this.broadcastShotId;
    this.broadcastShotId = shot.id;
    const focus = sampleCourse(raceProgressToCourseProgress(focusRaceProgress, HORSE_NOSE_OFFSET));
    const cameraOrigin =
      shot.movement === 'fixed'
        ? sampleCourse(raceProgressToCourseProgress(shot.anchorRaceProgress ?? focusRaceProgress))
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
          : Math.abs(rival.progress - overtaker.progress) * COURSE_LENGTH;
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
    if (this.cameraMode === 'follow') this.setCameraMode('free');
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

export function postFinishCourseProgress(
  positionMs: number,
  visualFinishTimeMs: number,
  finishSpeedMps = 18,
): number {
  const elapsedSeconds = Math.max(0, positionMs - visualFinishTimeMs) / 1_000;
  return (
    FINISH_ROOT_PROGRESS +
    Math.min(32, elapsedSeconds * Math.max(0, finishSpeedMps)) / COURSE_LENGTH
  );
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
