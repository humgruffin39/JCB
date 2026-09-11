import * as THREE from 'three';
import { RACE_START_COURSE_PROGRESS, raceProgressToCourseProgress } from './race-course.js';
import {
  createClouds,
  createFloodlights,
  createHorizon,
  createInfield,
} from './race-environment-scenery.js';
import { createGrandstand, type Grandstand } from './race-environment-grandstand.js';
import { createTrackside } from './race-environment-trackside.js';
import { venueTheme, type VenueTheme } from './race-venue-theme.js';
import { createFinishStructure, createStartingGate } from './race-environment-structures.js';
import {
  createGroundTexture,
  createTrackTexture,
  type RaceSurface,
} from './race-environment-textures.js';
import {
  createRails,
  createSecondSurface,
  createTrack,
  placeOnCourse,
} from './race-environment-track.js';

export type { RaceSurface } from './race-environment-textures.js';
export { outerCoursePosition } from './race-environment-scenery.js';

export class RaceEnvironment {
  readonly group = new THREE.Group();
  private readonly gateDoors: readonly THREE.Group[];
  private readonly grandstand: Grandstand;
  private readonly ownedTextures: readonly THREE.Texture[];
  private readonly distanceM: number;

  constructor(
    renderer: THREE.WebGLRenderer,
    distanceM = 1_200,
    surface: RaceSurface = 'turf',
    theme: VenueTheme = venueTheme('standard'),
    // How much of the crowd to build. A phone on the lowest tier still gets a
    // full stand, just a thinner one.
    private readonly detail = 1,
  ) {
    this.distanceM = distanceM;
    const groundTexture = createGroundTexture(renderer, surface, theme);
    const trackTexture = createTrackTexture(renderer, surface, theme);
    const innerSurface = surface === 'turf' ? 'dirt' : 'turf';
    const innerTexture = createTrackTexture(renderer, innerSurface, theme);
    this.ownedTextures = [groundTexture, trackTexture, innerTexture];
    this.group.add(
      createTrack(groundTexture, trackTexture, distanceM),
      createSecondSurface(innerTexture, distanceM),
      createRails(distanceM, theme),
      createInfield(theme),
      createHorizon(distanceM, theme),
      createClouds(distanceM, theme),
      createFloodlights(distanceM, theme),
    );
    this.grandstand = createGrandstand(distanceM, theme, detail);
    this.group.add(this.grandstand.group, createTrackside(distanceM, theme));
    const gate = createStartingGate();
    placeOnCourse(gate.group, RACE_START_COURSE_PROGRESS, 1.15, distanceM);
    this.gateDoors = gate.doors;
    const finish = createFinishStructure();
    placeOnCourse(finish, 0, 0, distanceM);
    this.group.add(gate.group, finish);
  }

  /**
   * @param leaderProgress Where the front of the field is, 0 at the gate and 1
   * at the post. The crowd noise follows it down the straight.
   */
  update(positionMs: number, leaderProgress = 0): void {
    // The stand only wakes up as the field turns for home, and peaks at the
    // post. Cheering for a back straight nobody can see reads as fake.
    const excitement = THREE.MathUtils.smoothstep(leaderProgress, 0.55, 0.97);
    if (this.detail < 0.35) return this.openGate(positionMs);
    this.grandstand.update(
      positionMs,
      excitement,
      raceProgressToCourseProgress(Math.min(leaderProgress, 1), 0, this.distanceM),
    );
    this.openGate(positionMs);
  }

  private openGate(positionMs: number): void {
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
