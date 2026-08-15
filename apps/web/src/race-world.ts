import * as THREE from 'three';
import { getFinishCameraShot } from './race-camera-director.js';
import { raceProgressToCourseProgress, sampleCourse } from './race-course.js';
import { RaceEnvironment, type RaceSurface } from './race-environment.js';
import {
  createHorseRig,
  loadHorseAssets,
  type HorseCoatColor,
  type HorseRig,
} from './race-horse-model.js';
import type { RaceCameraMode, RaceWorldState } from './race-world-types.js';
import {
  calculateFinishSnapshotCamera,
  fitFinishSnapshotDimensions,
  readRenderTargetDataUrl,
} from './race-world-snapshot.js';
import { RaceWorldCameraController } from './race-world-camera.js';
import { createRaceWorldScene } from './race-world-scene.js';
import type { RaceRenderQuality } from './race-viewer-performance.js';
import { RaceHorseField } from './race-world-horses.js';
import { RACE_RENDER_QUALITY, renderPixelRatioFor } from './race-world-render-quality.js';

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

export class RaceWorld {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly environment: RaceEnvironment;
  private readonly sky: THREE.Mesh;
  private readonly horseField: RaceHorseField;
  private readonly cameraController: RaceWorldCameraController;
  private finishSnapshotDataUrl: string | undefined;
  private finishSnapshotAttempts = 0;
  private finishSnapshotFailed = false;
  private lastPositionMs = 0;
  private viewportWidth = 1;
  private viewportHeight = 1;
  private renderQuality: RaceRenderQuality = 'high';
  private renderPixelRatio = 0;

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
    this.horseField = new RaceHorseField(rigs, distanceM);
    this.cameraController = new RaceWorldCameraController(
      renderer,
      this.camera,
      worldScene.orbit,
      worldScene.sun,
      worldScene.sunTarget,
      distanceM,
      this.horseField.horses,
      onCameraModeChange,
      onTrackedHorseChange,
    );

    for (const horse of this.horseField.horses) this.scene.add(horse.rig.root);
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
    initialRenderQuality: RaceRenderQuality = 'high',
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
    const settings = RACE_RENDER_QUALITY[initialRenderQuality];
    renderer.shadowMap.enabled = settings.shadows;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.maximumPixelRatio));

    const rigs: HorseRig[] = [];
    let environment: RaceEnvironment | undefined;
    try {
      const assets = await loadHorseAssets(renderer);
      for (let index = 0; index < 8; index += 1) {
        rigs.push(createHorseRig(assets, index + 1, horseCoats.get(index + 1)));
      }
      environment = new RaceEnvironment(renderer, distanceM, surface);
      const world = new RaceWorld(
        renderer,
        environment,
        rigs,
        distanceM,
        onCameraModeChange,
        onTrackedHorseChange,
        onFinishSnapshot,
        onFinishSnapshotError,
      );
      world.setRenderQuality(initialRenderQuality);
      return world;
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

  setInteractive(interactive: boolean): void {
    this.cameraController.setInteractive(interactive);
  }

  setRenderQuality(quality: RaceRenderQuality): void {
    if (quality === this.renderQuality && this.viewportWidth > 1 && this.viewportHeight > 1) return;
    const previousShadows = this.renderer.shadowMap.enabled;
    const settings = RACE_RENDER_QUALITY[quality];
    this.renderQuality = quality;
    this.renderer.shadowMap.enabled = settings.shadows;
    if (previousShadows !== settings.shadows) {
      this.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials: readonly THREE.Material[] = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => {
          material.needsUpdate = true;
        });
      });
    }
    this.applyRenderSize();
  }

  resize(width: number, height: number): void {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    this.viewportWidth = safeWidth;
    this.viewportHeight = safeHeight;
    this.applyRenderSize();
    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
  }

  private applyRenderSize(): void {
    const pixelRatio = renderPixelRatioFor(
      this.renderQuality,
      typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      this.viewportWidth,
      this.viewportHeight,
    );
    if (Math.abs(pixelRatio - this.renderPixelRatio) > 0.001) {
      this.renderPixelRatio = pixelRatio;
      this.renderer.setPixelRatio(pixelRatio);
    }
    this.renderer.setSize(this.viewportWidth, this.viewportHeight, false);
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

    const horseUpdate = this.horseField.update(state, rewound, snap, deltaSeconds);
    const leaderProgress = horseUpdate.leaderProgress;
    const focusRaceProgress = state.isPhoto ? 1 : Math.min(leaderProgress, 1);

    if (
      !state.isPhoto &&
      !this.finishSnapshotFailed &&
      this.finishSnapshotDataUrl === undefined &&
      this.finishSnapshotAttempts < 3 &&
      horseUpdate.hasFinisher
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
    const { width, height } = fitFinishSnapshotDimensions(drawingBufferSize.x, drawingBufferSize.y);
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
    this.horseField.dispose(this.scene);
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
