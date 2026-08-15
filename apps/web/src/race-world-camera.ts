import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  getBattleCameraShot,
  selectBroadcastCameraShot,
  type BroadcastShotId,
} from './race-camera-director.js';
import { RaceCameraBattleTracker } from './race-camera-battle.js';
import { RaceCameraInputController, type SelectableCameraHorse } from './race-camera-input.js';
import { raceProgressToCourseProgress, sampleCourse } from './race-course.js';
import type { RaceCameraMode, RaceWorldState } from './race-world-types.js';

const HORSE_NOSE_OFFSET = 1.05;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export interface CameraHorse extends SelectableCameraHorse {
  readonly initialized: boolean;
}

export class RaceWorldCameraController {
  private cameraInitialized = false;
  private cameraMode: RaceCameraMode = 'follow';
  private readonly cameraTarget = new THREE.Vector3();
  private readonly targetCamera = new THREE.Vector3();
  private readonly targetLook = new THREE.Vector3();
  private readonly trackedFocus = new THREE.Vector3();
  private readonly trackedTarget = new THREE.Vector3();
  private readonly trackedShift = new THREE.Vector3();
  private trackedHorseNumber: number | undefined;
  private leaderHorseNumber: number | undefined;
  private trackedCameraInitialized = false;
  private broadcastShotId: BroadcastShotId | undefined;
  private readonly battleTracker: RaceCameraBattleTracker;
  private readonly inputController: RaceCameraInputController;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly orbit: OrbitControls,
    private readonly sun: THREE.DirectionalLight,
    private readonly sunTarget: THREE.Object3D,
    private readonly distanceM: number,
    private readonly horses: readonly CameraHorse[],
    private readonly onCameraModeChange?: (mode: RaceCameraMode) => void,
    private readonly onTrackedHorseChange?: (horseNumber: number | undefined) => void,
  ) {
    this.battleTracker = new RaceCameraBattleTracker(distanceM);
    this.inputController = new RaceCameraInputController(
      renderer.domElement,
      camera,
      orbit,
      horses,
      this.handleOrbitStart,
      (horseNumber) => this.setTrackedHorse(horseNumber),
    );
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

  setInteractive(interactive: boolean): void {
    this.inputController.setInteractive(interactive);
  }

  update(
    state: RaceWorldState,
    focusRaceProgress: number,
    rewound: boolean,
    snap: boolean,
    deltaSeconds: number,
  ): void {
    this.leaderHorseNumber = selectCameraLeaderHorseNumber(state.frame.horses);
    this.battleTracker.update(state, focusRaceProgress, rewound);
    if (state.isPhoto) return;
    if (this.cameraMode === 'horse') {
      this.updateTrackedHorseCamera();
      return;
    }
    const battleProgress =
      focusRaceProgress >= 0.9 ? undefined : this.battleTracker.focusProgressFor(state);
    this.updateCamera(
      battleProgress ?? focusRaceProgress,
      battleProgress !== undefined,
      snap,
      deltaSeconds,
    );
    this.orbit.target.copy(this.cameraTarget);
  }

  dispose(): void {
    this.inputController.dispose();
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
    const targetCamera = this.targetCamera
      .copy(cameraOrigin.position)
      .addScaledVector(cameraOrigin.tangent, shot.tangentOffset)
      .addScaledVector(cameraOrigin.normal, shot.normalOffset);
    targetCamera.y = shot.height;
    const targetLook = this.targetLook
      .copy(focus.position)
      .addScaledVector(focus.tangent, shot.lookAhead);
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
    const target = this.trackedTarget.copy(trackedHorse.rig.root.position);
    target.y = 1.25;
    if (!this.trackedCameraInitialized) {
      this.trackedShift.copy(target).sub(this.orbit.target);
      this.camera.position.add(this.trackedShift);
      this.orbit.target.copy(target);
      this.trackedFocus.copy(target);
      this.trackedCameraInitialized = true;
    } else {
      this.trackedShift.copy(target).sub(this.trackedFocus);
      this.camera.position.add(this.trackedShift);
      this.orbit.target.add(this.trackedShift);
      this.trackedFocus.copy(target);
    }
    this.orbit.update();
    this.updateSun(trackedHorse.rig.root.position);
  }
}

type CameraFrameHorse = RaceWorldState['frame']['horses'][number];

export function selectCameraLeaderHorseNumber(
  horses: readonly CameraFrameHorse[],
): number | undefined {
  let leader = horses.find((horse) => horse.rank === 1);
  if (leader !== undefined) return leader.horseNumber;
  for (const horse of horses) {
    if (
      leader === undefined ||
      horse.progress > leader.progress ||
      (horse.progress === leader.progress && horse.rank < leader.rank)
    ) {
      leader = horse;
    }
  }
  return leader?.horseNumber;
}
