import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface SelectableCameraHorse {
  readonly rig: {
    readonly horseNumber: number;
    readonly root: THREE.Object3D;
  };
}

/** Owns the DOM input boundary for the race camera and its event lifecycle. */
export class RaceCameraInputController {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private pointerStart: { readonly id: number; readonly x: number; readonly y: number } | undefined;
  private interactive = true;

  constructor(
    private readonly element: HTMLCanvasElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly orbit: OrbitControls,
    private readonly horses: readonly SelectableCameraHorse[],
    private readonly onOrbitStart: () => void,
    private readonly onHorseSelected: (horseNumber: number) => void,
  ) {
    orbit.addEventListener('start', this.handleOrbitStart);
    element.addEventListener('pointerdown', this.handlePointerDown);
    element.addEventListener('pointerup', this.handlePointerUp);
    element.addEventListener('pointercancel', this.handlePointerCancel);
    element.addEventListener('contextmenu', this.handleContextMenu);
  }

  setInteractive(interactive: boolean): void {
    this.interactive = interactive;
    this.orbit.enabled = interactive;
    if (!interactive) this.pointerStart = undefined;
  }

  dispose(): void {
    this.orbit.removeEventListener('start', this.handleOrbitStart);
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointerup', this.handlePointerUp);
    this.element.removeEventListener('pointercancel', this.handlePointerCancel);
    this.element.removeEventListener('contextmenu', this.handleContextMenu);
    this.orbit.dispose();
  }

  private readonly handleOrbitStart = (): void => {
    if (this.interactive) this.onOrbitStart();
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.interactive || event.button !== 0) return;
    this.pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.interactive) return;
    const start = this.pointerStart;
    this.pointerStart = undefined;
    if (start === undefined || start.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) return;
    const selectedHorse = this.pickHorse(event.clientX, event.clientY);
    if (selectedHorse !== undefined) this.onHorseSelected(selectedHorse);
  };

  private pickHorse(clientX: number, clientY: number): number | undefined {
    const bounds = this.element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return undefined;
    this.pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
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
