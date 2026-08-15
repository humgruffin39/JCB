import * as THREE from 'three';
import { getFinishCameraShot, type BroadcastCameraShot } from './race-camera-director.js';
import type { CourseSample } from './race-course.js';
import type { FinishSnapshotCamera } from './race-world-types.js';

export const MAX_FINISH_SNAPSHOT_PIXELS = 2_560 * 1_440;

export function fitFinishSnapshotDimensions(
  width: number,
  height: number,
  maximumPixels = MAX_FINISH_SNAPSHOT_PIXELS,
): { readonly width: number; readonly height: number } {
  const safeWidth = Number.isFinite(width) ? Math.max(1, Math.round(width)) : 1;
  const safeHeight = Number.isFinite(height) ? Math.max(1, Math.round(height)) : 1;
  const safeMaximumPixels = Number.isFinite(maximumPixels) ? Math.max(1, maximumPixels) : 1;
  const scale = Math.min(1, Math.sqrt(safeMaximumPixels / (safeWidth * safeHeight)));
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

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
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return undefined;
  const imageData = context.createImageData(width, height);
  const rowLength = width * 4;
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = (height - row - 1) * rowLength;
    imageData.data.set(pixels.subarray(sourceOffset, sourceOffset + rowLength), row * rowLength);
  }
  context.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  canvas.width = 1;
  canvas.height = 1;
  return dataUrl;
}
