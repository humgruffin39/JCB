import * as THREE from 'three';
import { TRACK_HALF_WIDTH } from './race-course.js';

const WHITE = 0xe8e7df;
const DARK_METAL = 0x26322c;

export function createStartingGate(): {
  readonly group: THREE.Group;
  readonly doors: readonly THREE.Group[];
} {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: DARK_METAL,
    metalness: 0.62,
    roughness: 0.36,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: 0xe5e1d4,
    metalness: 0.5,
    roughness: 0.32,
  });
  const laneWidth = 1.22;
  const firstLane = -4.27;
  const doors: THREE.Group[] = [];

  for (const x of [-0.72, 0.72]) {
    const topBeam = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 10.4), metal);
    topBeam.position.set(x, 2.72, 0);
    topBeam.castShadow = true;
    group.add(topBeam);
  }
  for (let z = -4.85; z <= 4.85; z += laneWidth) {
    const roofBrace = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.08, 0.07), accent);
    roofBrace.position.set(0, 2.72, z);
    roofBrace.castShadow = true;
    group.add(roofBrace);
  }

  for (let lane = 0; lane <= 8; lane += 1) {
    const z = firstLane - laneWidth / 2 + lane * laneWidth;
    for (const x of [-0.7, 0.7]) {
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.075, 2.55, 0.075), metal);
      upright.position.set(x, 1.32, z);
      upright.castShadow = true;
      group.add(upright);
    }
    for (const y of [0.78, 1.48, 2.18]) {
      const sideRail = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.055, 0.07), metal);
      sideRail.position.set(0, y, z);
      sideRail.castShadow = true;
      group.add(sideRail);
    }
  }

  for (let lane = 0; lane < 8; lane += 1) {
    const centerZ = firstLane + lane * laneWidth;
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(0.68, 1.18, centerZ + side * laneWidth * 0.48);
      const door = new THREE.Group();
      door.position.z = -side * laneWidth * 0.235;
      for (const y of [-1.02, -0.5, 0.02, 0.54, 1.02]) {
        const crossbar = new THREE.Mesh(
          new THREE.BoxGeometry(0.075, 0.052, laneWidth * 0.47),
          accent,
        );
        crossbar.position.y = y;
        crossbar.castShadow = true;
        door.add(crossbar);
      }
      for (const zOffset of [-laneWidth * 0.235, laneWidth * 0.235]) {
        const upright = new THREE.Mesh(new THREE.BoxGeometry(0.075, 2.1, 0.055), accent);
        upright.position.z = zOffset;
        upright.castShadow = true;
        door.add(upright);
      }
      hinge.add(door);
      group.add(hinge);
      doors.push(hinge);
    }
  }
  return { group, doors };
}

/**
 * The winning post: two banded pylons on plinths, a gantry across the course
 * with a lattice under it, and the mirror on the inside that a judge reads the
 * finish through. The rest of the venue caught up with it, so a bare pole and a
 * beam had started to look like the one thing nobody had finished.
 */
export function createFinishStructure(labelTexture: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.42 });
  const black = new THREE.MeshStandardMaterial({ color: 0x171817, roughness: 0.52 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9fb4c4,
    roughness: 0.12,
    metalness: 0.7,
  });

  for (const z of [-TRACK_HALF_WIDTH - 0.35, TRACK_HALF_WIDTH + 0.35]) {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 1.6), white);
    plinth.position.set(0, 0.27, z);
    plinth.receiveShadow = true;
    group.add(plinth);

    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.3, 0.5), white);
    pylon.position.set(0, 3.12, z);
    pylon.castShadow = true;
    group.add(pylon);
    for (let y = 0.5; y < 5.7; y += 0.72) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.34, 0.53), black);
      band.position.set(0, y, z);
      group.add(band);
    }
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 4), white);
    finial.position.set(0, 6.7, z);
    group.add(finial);
  }

  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.52, 13.2), black);
  beam.position.set(0, 6.05, 0);
  beam.castShadow = true;
  group.add(beam);
  const underBeam = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.24, 13.2), black);
  underBeam.position.set(0, 5.35, 0);
  group.add(underBeam);
  // A zig-zag web between the two chords, which is what a gantry actually is.
  for (let index = 0; index < 16; index += 1) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.86, 0.14), black);
    strut.position.set(0, 5.7, -6.2 + index * 0.83);
    strut.rotation.x = index % 2 === 0 ? 0.55 : -0.55;
    group.add(strut);
  }

  // The judge's mirror, angled at the line from the infield side.
  const mirrorPost = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 6), white);
  mirrorPost.position.set(0, 1.3, TRACK_HALF_WIDTH + 2.4);
  group.add(mirrorPost);
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 1.1), glass);
  mirror.position.set(0, 3.1, TRACK_HALF_WIDTH + 2.4);
  mirror.rotation.z = 0.18;
  group.add(mirror);

  group.add(createFinishSign(labelTexture));
  return group;
}

export function createFinishSign(labelTexture: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  const backingMaterial = new THREE.MeshStandardMaterial({
    color: 0x171817,
    roughness: 0.52,
  });
  const signBacking = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.88, 0.12), backingMaterial);
  signBacking.position.set(0.2, 4.85, -TRACK_HALF_WIDTH - 0.64);
  signBacking.castShadow = true;
  group.add(signBacking);

  const signMaterial = new THREE.MeshStandardMaterial({
    map: labelTexture,
    color: 0xffffff,
    roughness: 0.72,
    side: THREE.FrontSide,
  });
  // Lettered on the course side only. A second face on the back of the board
  // read as a mirrored FINISH from the stands, which no real board does.
  const signGeometry = new THREE.PlaneGeometry(2.55, 0.7);
  const infieldFace = new THREE.Mesh(signGeometry, signMaterial);
  infieldFace.name = 'finish-sign-infield-face';
  infieldFace.position.set(0.2, 4.85, -TRACK_HALF_WIDTH - 0.57);
  group.add(infieldFace);
  return group;
}
