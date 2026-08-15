import * as THREE from 'three';
import {
  COURSE_RADIUS_Z,
  courseRadiusXForDistance,
  createOffsetCourseCurve,
  sampleCourse,
  TRACK_HALF_WIDTH,
} from './race-course.js';

const WHITE = 0xe8e7df;

export function createTrack(
  groundTexture: THREE.Texture,
  trackTexture: THREE.Texture,
  distanceM: number,
): THREE.Group {
  const group = new THREE.Group();
  const courseRadiusX = courseRadiusXForDistance(distanceM);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(courseRadiusX * 2 + 150, COURSE_RADIUS_Z * 2 + 150),
    new THREE.MeshStandardMaterial({ map: groundTexture, color: 0xffffff, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  group.add(ground);

  const trackMaterial = new THREE.MeshStandardMaterial({
    map: trackTexture,
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const track = new THREE.Mesh(createCourseRibbonGeometry(distanceM), trackMaterial);
  track.receiveShadow = true;
  group.add(track);

  const finishLine = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.025, TRACK_HALF_WIDTH * 2),
    new THREE.MeshStandardMaterial({ color: 0xf3f1e9, roughness: 0.84 }),
  );
  placeOnCourse(finishLine, 0, 0, distanceM);
  finishLine.position.y = 0.018;
  finishLine.receiveShadow = true;
  group.add(finishLine);
  return group;
}

function createCourseRibbonGeometry(distanceM: number): THREE.BufferGeometry {
  const segments = 512;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    for (const side of [-TRACK_HALF_WIDTH, TRACK_HALF_WIDTH]) {
      const sample = sampleCourse(progress, side, distanceM);
      positions.push(sample.position.x, 0, sample.position.z);
      normals.push(0, 1, 0);
      uvs.push(progress * 96, side < 0 ? 0 : 3);
    }
    if (index < segments) {
      const cursor = index * 2;
      indices.push(cursor, cursor + 1, cursor + 2, cursor + 2, cursor + 1, cursor + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function createRails(distanceM: number): THREE.Group {
  const group = new THREE.Group();
  const railMaterial = new THREE.MeshStandardMaterial({
    color: WHITE,
    roughness: 0.48,
    metalness: 0.04,
  });
  for (const offset of [-TRACK_HALF_WIDTH, TRACK_HALF_WIDTH]) {
    for (const y of [0.72, 1.12]) {
      const rail = new THREE.Mesh(
        new THREE.TubeGeometry(createOffsetCourseCurve(offset, y, distanceM), 512, 0.055, 8, true),
        railMaterial,
      );
      rail.castShadow = true;
      group.add(rail);
    }
  }

  const postGeometry = new THREE.CylinderGeometry(0.075, 0.09, 1.2, 10);
  const postsPerRail = 112;
  const posts = new THREE.InstancedMesh(postGeometry, railMaterial, postsPerRail * 2);
  const matrix = new THREE.Matrix4();
  let cursor = 0;
  for (const offset of [-TRACK_HALF_WIDTH, TRACK_HALF_WIDTH]) {
    for (let index = 0; index < postsPerRail; index += 1) {
      const position = sampleCourse(index / postsPerRail, offset, distanceM).position;
      matrix.makeTranslation(position.x, 0.58, position.z);
      posts.setMatrixAt(cursor, matrix);
      cursor += 1;
    }
  }
  posts.count = cursor;
  posts.castShadow = true;
  posts.receiveShadow = true;
  group.add(posts);
  return group;
}

export function placeOnCourse(
  object: THREE.Object3D,
  courseProgress: number,
  forwardOffset = 0,
  distanceM = 1_200,
): void {
  const sample = sampleCourse(courseProgress, 0, distanceM);
  object.position.copy(sample.position).addScaledVector(sample.tangent, forwardOffset);
  object.rotation.y = sample.heading;
}
