import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  getBattleCameraShot,
  selectBroadcastCameraShot,
  type BroadcastShotId,
} from './race-camera-director.js';
import { raceProgressToCourseProgress, sampleCourse } from './race-course.js';
import type { RaceCameraMode, RaceWorldState } from './race-world-types.js';

const HORSE_NOSE_OFFSET = 1.05;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export interface CameraHorse {
  readonly rig: {
    readonly horseNumber: number;
    readonly root: THREE.Object3D;
  };
  readonly initialized: boolean;
}

export class RaceWorldCameraController {
  private cameraInitialized = false;
  private cameraMode: RaceCameraMode = 'follow';
  private readonly cameraTarget = new THREE.Vector3();
  private readonly trackedFocus = new THREE.Vector3();
  private trackedHorseNumber: number | undefined;
  private leaderHorseNumber: number | undefined;
  private trackedCameraInitialized = false;
  private broadcastShotId: BroadcastShotId | undefined;
  private readonly previousRanks = new Map<number, number>();
  private readonly raycaster = new THREE.Raycaster();
  private battleHorseNumbers: readonly [number, number] | undefined;
  private battleUntilMs = 0;
  private lastBattleCutMs = Number.NEGATIVE_INFINITY;
  private pointerStart: { readonly id: number; readonly x: number; readonly y: number } | undefined;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly orbit: OrbitControls,
    private readonly sun: THREE.DirectionalLight,
    private readonly sunTarget: THREE.Object3D,
    private readonly distanceM: number,
    private readonly horses: readonly CameraHorse[],
    private readonly onCameraModeChange?: (mode: RaceCameraMode) => void,
    private readonly onTrackedHorseChange?: (horseNumber: number | undefined) => void,
  ) {
    this.orbit.addEventListener('start', this.handleOrbitStart);
    renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    renderer.domElement.addEventListener('pointercancel', this.handlePointerCancel);
    renderer.domElement.addEventListener('contextmenu', this.handleContextMenu);
  }

  get mode(): RaceCameraMode {
    return this.cameraMode;
  }

  get initialized(): boolean {
    return this.cameraInitialized;
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

  update(
    state: RaceWorldState,
    focusRaceProgress: number,
    rewound: boolean,
    snap: boolean,
    deltaSeconds: number,
  ): void {
    this.leaderHorseNumber =
      state.frame.horses.find((horse) => horse.rank === 1)?.horseNumber ??
      [...state.frame.horses].sort(
        (left, right) => right.progress - left.progress || left.rank - right.rank,
      )[0]?.horseNumber;
    this.updateBattleSelection(state, focusRaceProgress, rewound);
    if (state.isPhoto) return;
    if (this.cameraMode === 'horse') {
      this.updateTrackedHorseCamera();
      return;
    }
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

  dispose(): void {
    this.orbit.removeEventListener('start', this.handleOrbitStart);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.handlePointerCancel);
    this.renderer.domElement.removeEventListener('contextmenu', this.handleContextMenu);
    this.orbit.dispose();
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
