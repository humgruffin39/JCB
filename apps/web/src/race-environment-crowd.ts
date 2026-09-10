import * as THREE from 'three';
import type { VenueTheme } from './race-venue-theme.js';

export interface CrowdPlacement {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

export interface CrowdRow {
  /** Distance outside the running rail, in metres. */
  readonly depth: number;
  readonly height: number;
  /** 0 when the row is empty, 1 when it is packed shoulder to shoulder. */
  readonly density: number;
  readonly standing: boolean;
}

export interface CrowdInput {
  /**
   * Where a seat goes. `along` runs 0 to 1 across the stand and `depth` is how
   * far back the row sits, so the builder does not care what shape it is
   * filling.
   */
  place(along: number, depth: number): CrowdPlacement;
  /** How long the stand actually is, so seat spacing stays in metres. */
  readonly lengthM: number;
  readonly rows: readonly CrowdRow[];
  readonly theme: VenueTheme;
  /** Scales how many people are built, for weaker devices. */
  readonly detail?: number;
  /** Aisles cut through the rows, as fractions along the stand. */
  readonly aisles?: readonly number[];
}

export interface Crowd {
  readonly group: THREE.Group;
  readonly count: number;
  /**
   * @param excitement 0 while nothing is happening, 1 as the field passes.
   * @param focusAlong Where the leader is *in this stand's own coordinate*, 0
   * at one end and 1 at the other. Anything outside that range simply means the
   * race is somewhere these people cannot see.
   */
  update(elapsedMs: number, excitement: number, focusAlong: number): void;
}

interface Spectator {
  readonly x: number;
  readonly z: number;
  readonly baseY: number;
  /** Position across the stand, matching what `update` is given. */
  readonly along: number;
  readonly phase: number;
  readonly eagerness: number;
  readonly quaternion: THREE.Quaternion;
  readonly scale: number;
}

export const SEAT_SPACING_M = 0.62;
const AISLE_HALF_WIDTH = 0.012;

/**
 * A stand full of people, built from two instanced meshes.
 *
 * Everything that stops a crowd reading as wallpaper is jitter: seats are not on
 * a perfect grid, no two spectators are the same height, and they do not all
 * face the same way. The wave is what makes them a crowd rather than a texture —
 * it travels with the leader, so the noise arrives where the race is.
 */
export function createCrowd(input: CrowdInput): Crowd {
  const group = new THREE.Group();
  const random = seededRandom(0x9e37_79b9);
  const spectators: Spectator[] = [];
  const aisles = input.aisles ?? [];

  const bodyGeometry = new THREE.BoxGeometry(0.4, 0.62, 0.3);
  bodyGeometry.translate(0, 0.31, 0);
  const headGeometry = new THREE.SphereGeometry(0.15, 6, 5);
  headGeometry.translate(0, 0.74, 0);

  const detail = Math.min(1, Math.max(0.15, input.detail ?? 1));
  const capacity = input.rows.reduce(
    (total, row) => total + Math.ceil((input.lengthM / SEAT_SPACING_M) * row.density * detail) + 4,
    0,
  );
  const bodies = new THREE.InstancedMesh(
    bodyGeometry,
    new THREE.MeshStandardMaterial({ roughness: 0.92 }),
    capacity,
  );
  const heads = new THREE.InstancedMesh(
    headGeometry,
    new THREE.MeshStandardMaterial({ roughness: 0.85 }),
    capacity,
  );

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();
  const colour = new THREE.Color();
  const axis = new THREE.Vector3(0, 1, 0);
  let instance = 0;

  for (const row of input.rows) {
    const seats = Math.floor((input.lengthM / SEAT_SPACING_M) * row.density * detail);
    for (let seat = 0; seat < seats; seat += 1) {
      const along = (seat + 0.5) / seats;
      if (aisles.some((aisle) => Math.abs(along - aisle) < AISLE_HALF_WIDTH)) continue;
      // Nobody sits on a grid. A little slop along the row and across it is the
      // difference between a crowd and a chessboard.
      const jitterAlong = (random() - 0.5) * 0.55;
      const seatAlong = Math.min(1, Math.max(0, along + jitterAlong / input.lengthM));
      const depth = row.depth + (random() - 0.5) * 0.5;
      const sample = input.place(seatAlong, depth);
      const scale = 0.86 + random() * 0.3;
      position.set(sample.x, row.height, sample.z);
      quaternion.setFromAxisAngle(axis, sample.heading + (random() - 0.5) * 0.7);
      scaleVector.setScalar(scale);
      matrix.compose(position, quaternion, scaleVector);
      bodies.setMatrixAt(instance, matrix);
      heads.setMatrixAt(instance, matrix);
      const clothes = input.theme.grandstand.clothes;
      const skin = input.theme.grandstand.crowd;
      colour.setHex(clothes[Math.floor(random() * clothes.length)] ?? clothes[0]!);
      bodies.setColorAt(instance, colour);
      colour.setHex(skin[Math.floor(random() * skin.length)] ?? skin[0]!);
      heads.setColorAt(instance, colour);
      spectators.push({
        x: sample.x,
        z: sample.z,
        baseY: row.height,
        along: seatAlong,
        phase: random() * Math.PI * 2,
        // Front rows and standing terraces get louder sooner.
        eagerness: (row.standing ? 0.75 : 0.35) + random() * 0.4,
        quaternion: quaternion.clone(),
        scale,
      });
      instance += 1;
    }
  }

  bodies.count = instance;
  heads.count = instance;
  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  if (bodies.instanceColor !== null) bodies.instanceColor.needsUpdate = true;
  if (heads.instanceColor !== null) heads.instanceColor.needsUpdate = true;
  group.add(bodies, heads);

  const workMatrix = new THREE.Matrix4();
  const workPosition = new THREE.Vector3();
  const workScale = new THREE.Vector3();
  return {
    group,
    count: instance,
    update(elapsedMs: number, excitement: number, focusAlong: number): void {
      const time = elapsedMs / 1_000;
      for (let index = 0; index < spectators.length; index += 1) {
        const person = spectators[index]!;
        // The wave is a band of noise around the leader rather than a stadium
        // ripple: people cheer what is in front of them.
        const distance = Math.abs(person.along - focusAlong);
        const nearness = Math.max(0, 1 - distance / 0.16);
        const intensity = Math.min(1, excitement * person.eagerness + nearness * 0.9);
        const bounce = Math.abs(Math.sin(time * (3.1 + person.eagerness) + person.phase));
        const lift = 0.035 + intensity * 0.42 * bounce;
        workPosition.set(person.x, person.baseY + lift, person.z);
        workScale.setScalar(person.scale);
        workMatrix.compose(workPosition, person.quaternion, workScale);
        bodies.setMatrixAt(index, workMatrix);
        heads.setMatrixAt(index, workMatrix);
      }
      bodies.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
    },
  };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0xffff_ffff;
  };
}
