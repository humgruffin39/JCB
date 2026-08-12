import * as THREE from 'three';
import { getFinishCameraShot, type BroadcastCameraShot } from './race-camera-director.js';
import type { CourseSample } from './race-course.js';
import type { FinishSnapshotCamera } from './race-world-types.js';

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
  const candidates = [...validPositions]
    .sort(
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
