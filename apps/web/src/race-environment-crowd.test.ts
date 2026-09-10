import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCrowd, type CrowdRow } from './race-environment-crowd.js';
import { venueTheme } from './race-venue-theme.js';

const ROWS: readonly CrowdRow[] = [
  { depth: 0, height: 0.5, density: 0.9, standing: true },
  { depth: 1.2, height: 1.5, density: 0.9, standing: false },
];

function build() {
  // A straight line of seats, so `along` maps onto x and the wave is readable.
  return createCrowd({
    place: (along, depth) => ({ x: along * 100, z: depth, heading: 0 }),
    lengthM: 100,
    rows: ROWS,
    theme: venueTheme('standard'),
  });
}

function heightsAt(crowd: ReturnType<typeof build>, focusAlong: number): number[] {
  crowd.update(0, 0, focusAlong);
  const meshes = crowd.group.children.filter(
    (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
  );
  const bodies = meshes[0]!;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const heights: number[] = [];
  for (let index = 0; index < bodies.count; index += 1) {
    bodies.getMatrixAt(index, matrix);
    position.setFromMatrixPosition(matrix);
    heights.push(position.x);
  }
  return heights;
}

describe('grandstand crowd', () => {
  it('builds a body and a head for every spectator in one draw call each', () => {
    const crowd = build();
    const meshes = crowd.group.children.filter(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    );

    expect(meshes).toHaveLength(2);
    expect(meshes[0]!.count).toBe(crowd.count);
    expect(meshes[1]!.count).toBe(crowd.count);
    expect(crowd.count).toBeGreaterThan(100);
  });

  it('lifts the people the leader is passing and leaves the far end alone', () => {
    const crowd = build();
    const xs = heightsAt(crowd, 0);
    const near = xs.findIndex((x) => x < 8);
    const far = xs.findIndex((x) => x > 92);
    expect(near).toBeGreaterThanOrEqual(0);
    expect(far).toBeGreaterThanOrEqual(0);

    const lift = (index: number, focusAlong: number): number => {
      crowd.update(0, 0, focusAlong);
      const bodies = crowd.group.children[0] as THREE.InstancedMesh;
      const matrix = new THREE.Matrix4();
      bodies.getMatrixAt(index, matrix);
      return new THREE.Vector3().setFromMatrixPosition(matrix).y;
    };

    // The wave is a band around the leader: the near end reacts when the race is
    // at the near end, and the far end does not.
    expect(lift(near, 0)).toBeGreaterThan(lift(far, 0));
    expect(lift(far, 1)).toBeGreaterThan(lift(near, 1));
  });

  it('stays still when the race is somewhere this stand cannot see', () => {
    const crowd = build();
    const bodies = crowd.group.children[0] as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();

    crowd.update(0, 0, 4);
    bodies.getMatrixAt(0, matrix);
    const away = new THREE.Vector3().setFromMatrixPosition(matrix).y;
    crowd.update(0, 0, 0);
    bodies.getMatrixAt(0, matrix);
    const passing = new THREE.Vector3().setFromMatrixPosition(matrix).y;

    expect(away).toBeLessThan(passing);
  });
});
