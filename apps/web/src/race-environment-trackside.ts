import * as THREE from 'three';
import {
  courseLengthForDistance,
  createOffsetCourseCurve,
  HOME_STRAIGHT_HALF_PROGRESS,
  sampleCourse,
  TRACK_HALF_WIDTH,
} from './race-course.js';
import { outerCoursePosition } from './race-environment-scenery.js';
import type { VenueTheme } from './race-venue-theme.js';

const SCREEN_WIDTH_M = 66;
const SCREEN_HEIGHT_M = 11;
const SCREEN_DEPTH_M = 1.8;
/** Middle of the back straight: progress 0 is the middle of the home one. */
const BACK_STRAIGHT_PROGRESS = 0.5;

export function createTrackside(distanceM: number, theme: VenueTheme): THREE.Group {
  const group = new THREE.Group();
  const courseLength = courseLengthForDistance(distanceM);

  group.add(createBigScreen(distanceM, theme));
  group.add(createFurlongMarkers(distanceM, courseLength, theme));
  group.add(createCameraTowers(distanceM, theme));
  group.add(createInfield(distanceM, theme));
  group.add(createPerimeter(distanceM, theme));
  return group;
}

/**
 * The screen stands on the back straight facing the stand, which is where a
 * course puts it: the crowd is on one side, so the picture goes on the other.
 * It is very wide and shallow, like a real turf vision, rather than a monitor on
 * a stick.
 */
function createBigScreen(distanceM: number, theme: VenueTheme): THREE.Group {
  const screen = new THREE.Group();
  const anchor = sampleCourse(BACK_STRAIGHT_PROGRESS, 24, distanceM);
  screen.position.set(anchor.position.x, 0, anchor.position.z);
  // Face along the inward normal, which points across the infield at the stand
  // whichever way round the course is drawn.
  screen.rotation.y = Math.atan2(anchor.normal.x, anchor.normal.z);

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: theme.screen.frame,
    roughness: 0.72,
    metalness: 0.2,
  });
  const baseY = 8;
  const centreY = baseY + SCREEN_HEIGHT_M / 2;

  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(SCREEN_WIDTH_M, SCREEN_HEIGHT_M, SCREEN_DEPTH_M),
    frameMaterial,
  );
  housing.position.y = centreY;
  screen.add(housing);

  // The panel stands proud of the housing rather than lying on its surface: two
  // coplanar faces fight for the same depth and flicker.
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(SCREEN_WIDTH_M - 1.8, SCREEN_HEIGHT_M - 1.5, 0.3),
    new THREE.MeshStandardMaterial({
      color: theme.screen.face,
      emissive: new THREE.Color(theme.screen.glow),
      emissiveIntensity: theme.grandstand.litFacade ? 0.95 : 0.45,
      roughness: 0.55,
    }),
  );
  face.position.set(0, centreY, SCREEN_DEPTH_M / 2 + 0.16);
  screen.add(face);

  // Legs only. The bracing and the sill reached out toward the track and kept
  // swinging through the back straight shots.
  const legGeometry = new THREE.BoxGeometry(1.5, baseY, 1.2);
  for (const offset of [-SCREEN_WIDTH_M / 2 + 6, -8, 8, SCREEN_WIDTH_M / 2 - 6]) {
    const leg = new THREE.Mesh(legGeometry, frameMaterial);
    leg.position.set(offset, baseY / 2, -0.2);
    screen.add(leg);
  }

  return screen;
}

function createFurlongMarkers(
  distanceM: number,
  courseLength: number,
  theme: VenueTheme,
): THREE.Group {
  const group = new THREE.Group();
  const postMaterial = new THREE.MeshStandardMaterial({ color: theme.marker.post, roughness: 0.7 });
  const capMaterial = new THREE.MeshStandardMaterial({
    color: theme.marker.cap,
    roughness: 0.6,
    emissive: new THREE.Color(theme.marker.cap),
    emissiveIntensity: theme.grandstand.litFacade ? 0.45 : 0.05,
  });
  const markerCount = Math.max(2, Math.floor(distanceM / 200));
  for (let index = 1; index <= markerCount; index += 1) {
    const metresBack = index * 200;
    if (metresBack >= distanceM) break;
    // Between the two courses, where a marker stands, not on the dirt.
    const sample = sampleCourse(1 - metresBack / courseLength, TRACK_HALF_WIDTH + 3.4, distanceM);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 2.4, 6), postMaterial);
    post.position.set(sample.position.x, 1.2, sample.position.z);
    group.add(post);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.62, 0.12), capMaterial);
    cap.position.set(sample.position.x, 2.55, sample.position.z);
    cap.rotation.y = sample.heading;
    group.add(cap);
  }
  return group;
}

/** Camera platforms round the outside, each turned to look at the course. */
function createCameraTowers(distanceM: number, theme: VenueTheme): THREE.Group {
  const group = new THREE.Group();
  const mast = new THREE.MeshStandardMaterial({ color: theme.perimeter.fence, roughness: 0.65 });
  const deck = new THREE.MeshStandardMaterial({
    color: theme.grandstand.structure,
    roughness: 0.85,
  });
  const height = 9.5;
  for (const progress of [0.22, 0.38, 0.5, 0.62, 0.78]) {
    const base = outerCoursePosition(progress, 9, distanceM);
    const target = sampleCourse(progress, 0, distanceM).position;
    const tower = new THREE.Group();
    tower.position.set(base.x, 0, base.z);
    // Local +Z points at the racing line, so the rail and the operator face the
    // race instead of whichever way the world axes happen to run.
    tower.rotation.y = Math.atan2(target.x - base.x, target.z - base.z);

    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, height, 6), mast);
    column.position.y = height / 2;
    tower.add(column);
    const platform = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.35, 2.8), deck);
    platform.position.y = height;
    tower.add(platform);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.9, 0.12), mast);
    rail.position.set(0, height + 0.62, 1.35);
    tower.add(rail);
    const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.9, height, 0.12), mast);
    ladder.position.set(0, height / 2, -0.9);
    tower.add(ladder);
    group.add(tower);
  }
  return group;
}

/** What fills the middle: a planting bed inside the home turn, and marquees. */
function createInfield(distanceM: number, theme: VenueTheme): THREE.Group {
  const group = new THREE.Group();
  const anchor = sampleCourse(1 - HOME_STRAIGHT_HALF_PROGRESS * 0.7, 34, distanceM);

  const bed = new THREE.Mesh(
    new THREE.CylinderGeometry(13, 13.6, 0.5, 32),
    new THREE.MeshStandardMaterial({ color: theme.perimeter.hedge, roughness: 1 }),
  );
  bed.position.set(anchor.position.x, 0.25, anchor.position.z);
  bed.scale.z = 0.55;
  group.add(bed);

  // The flowers lie flat on the bed. Standing them up as a second cylinder put a
  // drum in the middle of the infield.
  const flowers = new THREE.Mesh(
    new THREE.CircleGeometry(11.4, 32),
    new THREE.MeshStandardMaterial({ color: theme.planting, roughness: 1 }),
  );
  flowers.rotation.x = -Math.PI / 2;
  flowers.position.set(anchor.position.x, 0.51, anchor.position.z);
  flowers.scale.y = 0.55;
  group.add(flowers);

  const canvas = new THREE.MeshStandardMaterial({
    color: theme.grandstand.structure,
    roughness: 0.96,
    side: THREE.DoubleSide,
  });
  for (const [progress, lateral] of [
    [0.3, 36],
    [0.34, 34],
    [0.7, 36],
  ] as const) {
    const sample = sampleCourse(progress, lateral, distanceM);
    const tent = new THREE.Mesh(new THREE.ConeGeometry(3.6, 2.8, 8), canvas);
    tent.position.set(sample.position.x, 3.1, sample.position.z);
    group.add(tent);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 1.8, 8, 1, true), canvas);
    wall.position.set(sample.position.x, 0.9, sample.position.z);
    group.add(wall);
  }
  return group;
}

/** The boundary: a service road, a continuous hedge, and a fence behind it. */
function createPerimeter(distanceM: number, theme: VenueTheme): THREE.Group {
  const group = new THREE.Group();
  const segments = 192;
  const road: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    for (const depth of [13, 20]) {
      const point = outerCoursePosition(progress, depth, distanceM);
      road.push(point.x, 0.01, point.z);
    }
    if (index < segments) {
      const cursor = index * 2;
      indices.push(cursor, cursor + 1, cursor + 2, cursor + 2, cursor + 1, cursor + 3);
    }
  }
  const roadGeometry = new THREE.BufferGeometry();
  roadGeometry.setAttribute('position', new THREE.Float32BufferAttribute(road, 3));
  // Index first: normals computed on an unindexed strip come out per-triangle and
  // band the road black and white.
  roadGeometry.setIndex(indices);
  roadGeometry.computeVertexNormals();
  const roadMesh = new THREE.Mesh(
    roadGeometry,
    new THREE.MeshStandardMaterial({
      color: theme.perimeter.road,
      roughness: 0.98,
      side: THREE.DoubleSide,
    }),
  );
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // The hedge runs continuously: each box is cut to the gap between its
  // neighbours, so it is a hedge and not a row of skips.
  const hedgeDepth = TRACK_HALF_WIDTH + 21;
  const hedgeCount = 220;
  const hedges = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1.5, 1.3),
    new THREE.MeshStandardMaterial({ color: theme.perimeter.hedge, roughness: 1 }),
    hedgeCount,
  );
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const axis = new THREE.Vector3(0, 1, 0);
  for (let index = 0; index < hedgeCount; index += 1) {
    const from = sampleCourse(index / hedgeCount, -hedgeDepth, distanceM);
    const to = sampleCourse((index + 1) / hedgeCount, -hedgeDepth, distanceM);
    position.copy(from.position).add(to.position).multiplyScalar(0.5);
    position.y = 0.75;
    quaternion.setFromAxisAngle(axis, from.heading);
    scale.set(from.position.distanceTo(to.position) * 1.06, 1, 1);
    matrix.compose(position, quaternion, scale);
    hedges.setMatrixAt(index, matrix);
  }
  hedges.computeBoundingSphere();
  group.add(hedges);

  // The fence is its own line further out, so nothing stands on the hedge.
  const fenceMaterial = new THREE.MeshStandardMaterial({
    color: theme.perimeter.fence,
    roughness: 0.7,
  });
  const fenceDepth = TRACK_HALF_WIDTH + 25;
  const postCount = 96;
  const posts = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.09, 0.09, 2.1, 5),
    fenceMaterial,
    postCount,
  );
  scale.set(1, 1, 1);
  for (let index = 0; index < postCount; index += 1) {
    const sample = sampleCourse(index / postCount, -fenceDepth, distanceM);
    position.set(sample.position.x, 1.05, sample.position.z);
    quaternion.setFromAxisAngle(axis, sample.heading);
    matrix.compose(position, quaternion, scale);
    posts.setMatrixAt(index, matrix);
  }
  posts.computeBoundingSphere();
  group.add(posts);
  for (const height of [1.35, 1.95]) {
    const rail = new THREE.Mesh(
      new THREE.TubeGeometry(
        createOffsetCourseCurve(-fenceDepth, height, distanceM),
        256,
        0.045,
        5,
        true,
      ),
      fenceMaterial,
    );
    group.add(rail);
  }
  return group;
}
