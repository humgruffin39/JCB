import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { describe, expect, it, vi } from 'vitest';
import { RaceCameraInputController } from './race-camera-input.js';

describe('RaceCameraInputController', () => {
  it('gates input and releases every owned listener with OrbitControls', () => {
    const canvasTarget = new EventTarget();
    const canvas = Object.assign(canvasTarget, {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    }) as unknown as HTMLCanvasElement;
    const orbitTarget = new EventTarget();
    const dispose = vi.fn();
    const orbit = Object.assign(orbitTarget, {
      enabled: true,
      dispose,
    }) as unknown as OrbitControls;
    const onOrbitStart = vi.fn();
    const controller = new RaceCameraInputController(
      canvas,
      new THREE.PerspectiveCamera(),
      orbit,
      [],
      onOrbitStart,
      vi.fn(),
    );

    orbitTarget.dispatchEvent(new Event('start'));
    expect(onOrbitStart).toHaveBeenCalledOnce();

    controller.setInteractive(false);
    expect(orbit.enabled).toBe(false);
    orbitTarget.dispatchEvent(new Event('start'));
    expect(onOrbitStart).toHaveBeenCalledOnce();

    const menuEvent = new Event('contextmenu', { cancelable: true });
    canvasTarget.dispatchEvent(menuEvent);
    expect(menuEvent.defaultPrevented).toBe(true);

    controller.dispose();
    orbitTarget.dispatchEvent(new Event('start'));
    expect(onOrbitStart).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
