import * as THREE from 'three';
import {
  COURSE_RADIUS_Z,
  courseRadiusXForDistance,
  sampleCourse,
  TRACK_HALF_WIDTH,
} from './race-course.js';

export function createInfield(): THREE.Group {
  const group = new THREE.Group();
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96),
    new THREE.MeshStandardMaterial({ color: 0x7fa6a5, roughness: 0.25, metalness: 0.04 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.scale.set(68, 22, 1);
  water.position.set(5, -0.02, 2);
  group.add(water);
  return group;
}

export function createHorizon(distanceM: number): THREE.Group {
  const group = new THREE.Group();
  const courseRadiusX = courseRadiusXForDistance(distanceM);
  const hillGeometry = new THREE.SphereGeometry(7, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const hillMaterial = new THREE.MeshStandardMaterial({ color: 0x456c34, roughness: 1 });
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

  const trunkGeometry = new THREE.CylinderGeometry(0.1, 0.15, 1.5, 7);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x59452e, roughness: 1 });
  const treeCount = 104;
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
  const treeGeometry = new THREE.IcosahedronGeometry(1, 2);
  const treeMaterial = new THREE.MeshStandardMaterial({ color: 0x31552d, roughness: 0.96 });
  const trees = new THREE.InstancedMesh(treeGeometry, treeMaterial, treeCount);
  for (let index = 0; index < treeCount; index += 1) {
    const progress = index / treeCount;
    const sceneryPosition = outerCoursePosition(progress, 16 + (index % 4) * 2.4, distanceM);
    const x = sceneryPosition.x;
    const z = sceneryPosition.z;
    const height = 0.72 + ((index * 13) % 9) / 20;
    position.set(x, 0.75 * height, z);
    scale.set(height, height, height);
    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(index, matrix);
    position.set(x, 2.3 * height, z);
    scale.set(0.8 * height, 1.45 * height, 0.8 * height);
    matrix.compose(position, quaternion, scale);
    trees.setMatrixAt(index, matrix);
  }
  trunks.castShadow = true;
  group.add(trunks);
  trees.castShadow = true;
  group.add(trees);
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

export function createClouds(distanceM: number): THREE.Group {
  const group = new THREE.Group();
  const courseRadiusX = courseRadiusXForDistance(distanceM);
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const material = new THREE.MeshBasicMaterial({
    color: 0xf5f6f1,
    transparent: true,
    opacity: 0.46,
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
