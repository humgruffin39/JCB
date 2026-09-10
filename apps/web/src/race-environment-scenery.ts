import * as THREE from 'three';
import {
  COURSE_RADIUS_Z,
  courseRadiusXForDistance,
  sampleCourse,
  TRACK_HALF_WIDTH,
} from './race-course.js';
import { venueTheme, type VenueTheme } from './race-venue-theme.js';

export function createInfield(theme: VenueTheme = venueTheme('standard')): THREE.Group {
  const group = new THREE.Group();
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96),
    new THREE.MeshStandardMaterial({
      color: theme.id === 'night' ? 0x24384c : 0x7fa6a5,
      roughness: theme.id === 'night' ? 0.08 : 0.25,
      metalness: theme.id === 'night' ? 0.35 : 0.04,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.scale.set(68, 22, 1);
  water.position.set(5, -0.02, 2);
  group.add(water);
  return group;
}

export function createHorizon(
  distanceM: number,
  theme: VenueTheme = venueTheme('standard'),
): THREE.Group {
  const group = new THREE.Group();
  const courseRadiusX = courseRadiusXForDistance(distanceM);
  const hillGeometry = new THREE.SphereGeometry(7, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const hillMaterial = new THREE.MeshStandardMaterial({
    color: theme.id === 'night' ? 0x172415 : 0x456c34,
    roughness: 1,
  });
  const hillCount = 44;
  const hills = new THREE.InstancedMesh(hillGeometry, hillMaterial, hillCount);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (let index = 0; index < hillCount; index += 1) {
    const angle = (index / hillCount) * Math.PI * 2;
    position.set(
      Math.cos(angle) * (courseRadiusX + 52 + (index % 3) * 7),
      -5.4,
      Math.sin(angle) * (COURSE_RADIUS_Z + 42 + (index % 4) * 5),
    );
    scale.set(1.5 + (index % 4) * 0.35, 0.65 + (index % 3) * 0.14, 1.3);
    matrix.compose(position, quaternion, scale);
    hills.setMatrixAt(index, matrix);
  }
  hills.receiveShadow = true;
  group.add(hills);

  return group;
}

export function outerCoursePosition(
  progress: number,
  distanceFromOuterRail: number,
  distanceM = 1_200,
): THREE.Vector3 {
  return sampleCourse(progress, -(TRACK_HALF_WIDTH + Math.max(0, distanceFromOuterRail)), distanceM)
    .position;
}

export function createClouds(
  distanceM: number,
  theme: VenueTheme = venueTheme('standard'),
): THREE.Group {
  const group = new THREE.Group();
  // Unlit cloud geometry reads as a dark disc from above, which is worse than no
  // cloud at all on a night sky.
  if (theme.cloud.opacity <= 0.15) return group;
  const courseRadiusX = courseRadiusXForDistance(distanceM);
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const material = new THREE.MeshBasicMaterial({
    color: theme.cloud.color,
    transparent: true,
    opacity: theme.cloud.opacity * 0.74,
    depthWrite: false,
    fog: true,
  });
  const clusterCount = 24;
  const clouds = new THREE.InstancedMesh(geometry, material, clusterCount * 3);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  let instance = 0;
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const angle = (cluster / clusterCount) * Math.PI * 2;
    const clusterX = Math.cos(angle) * (courseRadiusX + 85);
    const clusterY = 18 + (cluster % 4) * 2.7;
    const clusterZ = Math.sin(angle) * (COURSE_RADIUS_Z + 80);
    for (let puff = 0; puff < 3; puff += 1) {
      position.set(clusterX + puff * 4.4, clusterY + (puff % 2) * 0.8, clusterZ);
      scale.set(5.6 - puff * 0.7, 1.15 + (puff % 2) * 0.42, 2.5);
      matrix.compose(position, quaternion, scale);
      clouds.setMatrixAt(instance, matrix);
      instance += 1;
    }
  }
  group.add(clouds);
  return group;
}

/**
 * Four masts outside the turns. The lamps are emissive geometry with one small
 * point light each: enough to pool light on the track without paying for four
 * more shadow maps on a phone.
 */
export function createFloodlights(distanceM: number, theme: VenueTheme): THREE.Group {
  const group = new THREE.Group();
  if (theme.floodlights === undefined) return group;
  const { mast, lamp, intensity, range } = theme.floodlights;
  // A faint emissive keeps the masts readable as silhouettes against a dark sky.
  const mastMaterial = new THREE.MeshStandardMaterial({
    color: mast,
    roughness: 0.7,
    emissive: new THREE.Color(mast),
    emissiveIntensity: 0.12,
  });
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: lamp,
    emissive: new THREE.Color(lamp),
    emissiveIntensity: 1.8,
    roughness: 0.4,
  });
  const height = 34;
  // Six, spread away from the stand: four left the turns in the dark, which is
  // where a night race spends most of its time.
  for (const progress of [0.1, 0.24, 0.38, 0.52, 0.66, 0.8]) {
    const base = outerCoursePosition(progress, 26, distanceM);
    const inward = sampleCourse(progress, 0, distanceM).position;
    const tower = new THREE.Group();
    tower.position.copy(base);
    // Only the heading turns: tilting the group would stand the mast up at an
    // angle, because its origin sits on the ground and the track does not.
    tower.rotation.y = Math.atan2(-(inward.x - base.x), -(inward.z - base.z));

    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.85, height, 8), mastMaterial);
    column.position.y = height / 2;
    tower.add(column);

    // The head alone leans down at the track, the way a real mast is rigged.
    const head = new THREE.Group();
    head.position.y = height;
    head.rotation.x = -0.62;
    const rack = new THREE.Mesh(new THREE.BoxGeometry(9.5, 2.6, 0.9), mastMaterial);
    rack.position.y = 1.5;
    head.add(rack);
    for (let index = 0; index < 4; index += 1) {
      const lampMesh = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.9, 0.4), lampMaterial);
      lampMesh.position.set(-3.45 + index * 2.3, 1.5, -0.65);
      head.add(lampMesh);
    }
    tower.add(head);

    const light = new THREE.PointLight(lamp, intensity, range, 2);
    light.position.set(0, height - 1, -3);
    tower.add(light);
    group.add(tower);
  }
  return group;
}
