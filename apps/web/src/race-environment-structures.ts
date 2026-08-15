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

export function createFinishStructure(labelTexture: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.42 });
  const black = new THREE.MeshStandardMaterial({ color: 0x171817, roughness: 0.52 });
  for (const z of [-TRACK_HALF_WIDTH - 0.35, TRACK_HALF_WIDTH + 0.35]) {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.3, 0.5), white);
    pylon.position.set(0, 3.12, z);
    pylon.castShadow = true;
    group.add(pylon);
    for (let y = 0.5; y < 5.7; y += 0.72) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.34, 0.53), black);
      band.position.set(0, y, z);
      group.add(band);
    }
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.52, 13.2), black);
  beam.position.set(0, 6.05, 0);
  beam.castShadow = true;
  group.add(beam);
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
  const signGeometry = new THREE.PlaneGeometry(2.55, 0.7);
  const spectatorFace = new THREE.Mesh(signGeometry, signMaterial);
  spectatorFace.name = 'finish-sign-spectator-face';
  spectatorFace.position.set(0.2, 4.85, -TRACK_HALF_WIDTH - 0.71);
  spectatorFace.rotation.y = Math.PI;
  group.add(spectatorFace);

  const infieldFace = new THREE.Mesh(signGeometry, signMaterial);
  infieldFace.name = 'finish-sign-infield-face';
  infieldFace.position.set(0.2, 4.85, -TRACK_HALF_WIDTH - 0.57);
  group.add(infieldFace);
  return group;
}
