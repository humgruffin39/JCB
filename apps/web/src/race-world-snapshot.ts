import * as THREE from 'three';
import { getFinishCameraShot, type BroadcastCameraShot } from './race-camera-director.js';
import type { CourseSample } from './race-course.js';
import type { FinishSnapshotCamera } from './race-world-types.js';

export function calculateFinishSnapshotCamera(
  finishLine: Pick<CourseSample, 'position' | 'tangent' | 'normal'>,
  aspect: number,
  shot: BroadcastCameraShot = getFinishCameraShot(),
): FinishSnapshotCamera {
  const tangent = finishLine.tangent.clone().normalize();
  const normal = finishLine.normal.clone().normalize();
  const targetPosition = finishLine.position.clone().addScaledVector(tangent, shot.lookAhead);
  targetPosition.y = shot.lookHeight;

  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const portraitCompensation = THREE.MathUtils.clamp(1.65 / safeAspect, 1, 1.42);
  const fieldOfView = THREE.MathUtils.clamp(shot.fieldOfView * portraitCompensation, 18, 56);
  const cameraPosition = finishLine.position
    .clone()
    .addScaledVector(tangent, shot.tangentOffset)
    .addScaledVector(normal, shot.normalOffset);
  cameraPosition.y = shot.height;
  return { cameraPosition, targetPosition, fieldOfView };
}

export function readRenderTargetDataUrl(
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
