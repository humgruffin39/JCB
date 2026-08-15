import * as THREE from 'three';
import { RACE_START_COURSE_PROGRESS } from './race-course.js';
import { createClouds, createHorizon, createInfield } from './race-environment-scenery.js';
import { createFinishStructure, createStartingGate } from './race-environment-structures.js';
import {
  createFinishTexture,
  createGroundTexture,
  createTrackTexture,
  type RaceSurface,
} from './race-environment-textures.js';
import { createRails, createTrack, placeOnCourse } from './race-environment-track.js';

export type { RaceSurface } from './race-environment-textures.js';
export { outerCoursePosition } from './race-environment-scenery.js';
export { createFinishSign } from './race-environment-structures.js';

export class RaceEnvironment {
  readonly group = new THREE.Group();
  private readonly gateDoors: readonly THREE.Group[];
  private readonly ownedTextures: readonly THREE.Texture[];

  constructor(renderer: THREE.WebGLRenderer, distanceM = 1_200, surface: RaceSurface = 'turf') {
    const groundTexture = createGroundTexture(renderer, surface);
    const trackTexture = createTrackTexture(renderer, surface);
    const finishTexture = createFinishTexture(renderer);
    this.ownedTextures = [groundTexture, trackTexture, finishTexture];
    this.group.add(
      createTrack(groundTexture, trackTexture, distanceM),
      createRails(distanceM),
      createInfield(),
      createHorizon(distanceM),
      createClouds(distanceM),
    );
    const gate = createStartingGate();
    placeOnCourse(gate.group, RACE_START_COURSE_PROGRESS, 1.15, distanceM);
    this.gateDoors = gate.doors;
    const finish = createFinishStructure(finishTexture);
    placeOnCourse(finish, 0, 0, distanceM);
    this.group.add(gate.group, finish);
  }

  update(positionMs: number): void {
    const opening = THREE.MathUtils.smoothstep(positionMs, 350, 850);
    for (let index = 0; index < this.gateDoors.length; index += 1) {
      const direction = index % 2 === 0 ? -1 : 1;
      this.gateDoors[index]!.rotation.y = direction * opening * Math.PI * 0.48;
    }
  }

  dispose(): void {
    disposeRaceEnvironmentResources(this.group, this.ownedTextures);
  }
}

export function disposeRaceEnvironmentResources(
  group: THREE.Object3D,
  ownedTextures: readonly THREE.Texture[],
): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const mesh = object as THREE.Mesh;
    geometries.add(mesh.geometry);
    const meshMaterials: readonly THREE.Material[] = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    meshMaterials.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  ownedTextures.forEach((texture) => texture.dispose());
}
