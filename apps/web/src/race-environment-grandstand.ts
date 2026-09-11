import * as THREE from 'three';
import {
  HOME_STRAIGHT_HALF_PROGRESS,
  homeStraightLengthM,
  sampleCourse,
  TRACK_HALF_WIDTH,
} from './race-course.js';
import { createCrowd, SEAT_SPACING_M, type CrowdRow } from './race-environment-crowd.js';
import type { VenueTheme } from './race-venue-theme.js';

/**
 * The stand runs the whole home straight, stopping just short of each turn. The
 * straight itself grows with the race distance, so the stand does too and a
 * 2400m course is not left with a short stand floating in the middle of it.
 */
const STAND_SPAN_FRACTION = 0.97;
/**
 * Total spectators to build at full detail, however long the stand gets.
 *
 * Each one is two instances, so this is the single biggest lever on how long the
 * viewer takes to come up. A slow device that spends thirty seconds painting the
 * first frame misses the race it was opened to watch.
 */
const CROWD_BUDGET = 2_400;

const TERRACE_FRONT = TRACK_HALF_WIDTH + 3.2;
const TERRACE_ROWS = 5;
const TERRACE_RISE = 0.5;
const TERRACE_DEPTH = 1.4;

const CONCOURSE_DEPTH = 3.4;
const BOWL_ROWS = 12;
const BOWL_RISE = 1.05;
const BOWL_DEPTH = 1.2;

const BUILDING_DEPTH = 17;
const BUILDING_FLOORS = 5;
const FLOOR_HEIGHT = 4.2;
const COLONNADE_BAYS = 11;

const ROOF_BAYS = 22;
/** How many full scallops run the length of the roof. */
const ROOF_WAVES = 5;
const ROOF_WAVE_DEPTH = 3.6;
const ROOF_WAVE_LIFT = 1.1;

export interface Grandstand {
  readonly group: THREE.Group;
  /** @param focusProgress The leader's position round the course, 0 to 1. */
  update(elapsedMs: number, excitement: number, focusProgress: number): void;
}

/**
 * A stand built the way one is built: a terrace at the rail, a seating bowl, a
 * concourse, then a block of floors behind it, all under one cantilevered roof
 * carried on a colonnade. The previous version was a stack of floating slabs,
 * which is what made it read as scenery rather than a building.
 */
export function createGrandstand(distanceM: number, theme: VenueTheme, detail = 1): Grandstand {
  const group = new THREE.Group();
  const halfSpan = HOME_STRAIGHT_HALF_PROGRESS * STAND_SPAN_FRACTION;
  const start = 1 - halfSpan;
  const end = 1 + halfSpan;
  const lengthM = homeStraightLengthM(distanceM) * STAND_SPAN_FRACTION;

  const concrete = new THREE.MeshStandardMaterial({
    color: theme.grandstand.structure,
    roughness: 0.9,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: theme.grandstand.roof,
    roughness: 0.62,
    metalness: 0.18,
  });
  const seatMaterial = new THREE.MeshStandardMaterial({
    color: theme.grandstand.seats,
    roughness: 0.95,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: theme.grandstand.glass,
    emissive: new THREE.Color(theme.grandstand.glassGlow),
    emissiveIntensity: theme.grandstand.litFacade ? 1.25 : 0.06,
    roughness: 0.2,
    metalness: 0.4,
  });

  /**
   * A box laid along a slice of the home straight.
   *
   * Everything in the stand is one of these — treads, floor plates, glazing,
   * roof bays — so the geometry all follows the course rather than the world
   * axes, and a curved straight would carry it without further work.
   */
  const shell = (
    depth: number,
    y: number,
    width: number,
    height: number,
    material: THREE.Material,
    from = start,
    to = end,
  ): THREE.Mesh => {
    const front = sampleCourse(from, -depth, distanceM).position;
    const back = sampleCourse(to, -depth, distanceM).position;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(front.distanceTo(back) * (from === start ? 1 : 1.02), height, width),
      material,
    );
    mesh.position.set((front.x + back.x) / 2, y, (front.z + back.z) / 2);
    mesh.rotation.y = Math.atan2(back.x - front.x, back.z - front.z) + Math.PI / 2;
    mesh.receiveShadow = true;
    return mesh;
  };

  const rows: CrowdRow[] = [];

  // 1. The standing terrace at the rail.
  const terraceTop = 0.5 + TERRACE_ROWS * TERRACE_RISE;
  for (let index = 0; index < TERRACE_ROWS; index += 1) {
    const depth = TERRACE_FRONT + index * TERRACE_DEPTH;
    const top = 0.5 + index * TERRACE_RISE;
    group.add(shell(depth, top - TERRACE_RISE / 2, TERRACE_DEPTH, TERRACE_RISE, concrete));
    rows.push({ depth: depth - 0.28, height: top, density: 0.86, standing: true });
  }

  // 2. The concourse, the flat gap every stand has between the terrace and the
  // bowl. Without it the two run together into one long ramp.
  const concourseFront = TERRACE_FRONT + TERRACE_ROWS * TERRACE_DEPTH;
  group.add(
    shell(concourseFront + CONCOURSE_DEPTH / 2, terraceTop - 0.2, CONCOURSE_DEPTH, 0.4, concrete),
  );
  group.add(shell(concourseFront + CONCOURSE_DEPTH - 0.2, terraceTop + 0.55, 0.14, 1.1, trim));

  // 3. The seating bowl.
  const bowlFront = concourseFront + CONCOURSE_DEPTH + 0.6;
  const bowlBase = terraceTop + 1.4;
  for (let index = 0; index < BOWL_ROWS; index += 1) {
    const depth = bowlFront + index * BOWL_DEPTH;
    const top = bowlBase + index * BOWL_RISE;
    group.add(shell(depth, top - BOWL_RISE / 2, BOWL_DEPTH, BOWL_RISE, concrete));
    group.add(shell(depth - BOWL_DEPTH / 2 + 0.09, top + 0.21, 0.14, 0.42, seatMaterial));
    rows.push({ depth: depth - 0.22, height: top, density: 0.92, standing: false });
  }
  const bowlBack = bowlFront + BOWL_ROWS * BOWL_DEPTH;
  const bowlTop = bowlBase + BOWL_ROWS * BOWL_RISE;

  const crowd = createCrowd({
    place: (along, depth) => {
      const sample = sampleCourse(start + along * (end - start), -depth, distanceM);
      return { x: sample.position.x, z: sample.position.z, heading: sample.heading };
    },
    lengthM,
    rows,
    theme,
    // A longer straight must not mean a heavier frame, so the density falls as
    // the stand grows and the head count stays put.
    detail: detail * Math.min(1, CROWD_BUDGET / estimatedCrowd(rows, lengthM)),
    // Stairways up the bowl, which is what stops the rows looking printed.
    aisles: [0.14, 0.33, 0.5, 0.67, 0.86],
  });
  group.add(crowd.group);

  // 4. The building behind: floor plates, glazing between them, and a solid core
  // at the back. This is the mass that makes it a grandstand and not bleachers.
  const buildingFront = bowlBack + 1.2;
  const buildingBack = buildingFront + BUILDING_DEPTH;
  const buildingMiddle = (buildingFront + buildingBack) / 2;
  const buildingBase = bowlTop + 0.6;
  const buildingTop = buildingBase + BUILDING_FLOORS * FLOOR_HEIGHT;
  group.add(shell(buildingMiddle, buildingBase / 2, BUILDING_DEPTH, buildingBase, concrete));
  for (let floor = 0; floor < BUILDING_FLOORS; floor += 1) {
    const y = buildingBase + floor * FLOOR_HEIGHT;
    group.add(shell(buildingMiddle, y + 0.35, BUILDING_DEPTH, 0.7, concrete));
    const glazingY = y + FLOOR_HEIGHT / 2 + 0.3;
    group.add(shell(buildingFront + 0.15, glazingY, 0.3, FLOOR_HEIGHT - 1.3, glass));
    group.add(shell(buildingBack - 0.15, glazingY, 0.3, FLOOR_HEIGHT - 1.3, glass));
  }
  group.add(shell(buildingMiddle, buildingTop + 0.4, BUILDING_DEPTH, 0.8, concrete));
  group.add(shell(buildingBack + 0.6, buildingTop / 2, 1.2, buildingTop, concrete));

  // 5. The roof. One deck per bay, each reaching a different distance over the
  // bowl, so the front edge scallops instead of ruling a straight white line
  // across the sky. Each bay carries its own fascia and a raking strut back to
  // the colonnade, which is what makes it read as carried rather than floating.
  const roofY = buildingTop + 2.6;
  const roofBackDepth = buildingBack;
  const bayGeometry = (bay: number): { readonly front: number; readonly lift: number } => {
    const phase = (bay + 0.5) / ROOF_BAYS;
    const wave = Math.sin(phase * Math.PI * ROOF_WAVES);
    return {
      front: TERRACE_FRONT + 1.2 - wave * ROOF_WAVE_DEPTH,
      lift: wave * ROOF_WAVE_LIFT,
    };
  };
  for (let bay = 0; bay < ROOF_BAYS; bay += 1) {
    const bayStart = start + (bay / ROOF_BAYS) * (end - start);
    const bayEnd = start + ((bay + 1) / ROOF_BAYS) * (end - start);
    const { front, lift } = bayGeometry(bay);
    const span = roofBackDepth - front;
    group.add(shell(front + span / 2, roofY + lift, span, 0.5, trim, bayStart, bayEnd));
    group.add(shell(front + 0.3, roofY + lift - 1, 0.55, 2, trim, bayStart, bayEnd));
    group.add(shell(front + span * 0.55, roofY + lift - 0.65, 0.3, 0.8, trim, bayStart, bayEnd));
  }
  // An upper deck set back over the building, the second tier a big stand has.
  group.add(shell(buildingMiddle, roofY + ROOF_WAVE_LIFT + 3.4, BUILDING_DEPTH - 2, 0.45, trim));
  for (let index = 0; index < COLONNADE_BAYS; index += 1) {
    const progress = start + (index / (COLONNADE_BAYS - 1)) * (end - start);
    const sample = sampleCourse(progress, -buildingMiddle, distanceM);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.4, 0.4), trim);
    post.position.set(sample.position.x, roofY + ROOF_WAVE_LIFT + 1.7, sample.position.z);
    post.rotation.y = sample.heading;
    group.add(post);
  }

  // 6. The colonnade. Columns run the full height to the roof, one per bay, with
  // a cross beam so the roof has something to sit on.
  const columnDepth = bowlBack + 0.4;
  const columns = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.05, roofY, 1.05),
    concrete,
    COLONNADE_BAYS,
  );
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const axis = new THREE.Vector3(0, 1, 0);
  for (let index = 0; index < COLONNADE_BAYS; index += 1) {
    const progress = start + (index / (COLONNADE_BAYS - 1)) * (end - start);
    const sample = sampleCourse(progress, -columnDepth, distanceM);
    position.set(sample.position.x, roofY / 2, sample.position.z);
    quaternion.setFromAxisAngle(axis, sample.heading);
    matrix.compose(position, quaternion, scale);
    columns.setMatrixAt(index, matrix);
  }
  columns.castShadow = true;
  group.add(columns);
  group.add(shell(columnDepth, roofY - 1.2, 1.3, 1.3, concrete));

  // 7. End walls, stepped to the profile of what they close: full height across
  // the building, low across the open seating. One flat panel the height of the
  // block was the single biggest thing making the stand look unfinished.
  const endWall = (edge: number, from: number, to: number, height: number): void => {
    const inner = sampleCourse(edge, -from, distanceM);
    const outer = sampleCourse(edge, -to, distanceM);
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, height, inner.position.distanceTo(outer.position)),
      concrete,
    );
    wall.position.set(
      (inner.position.x + outer.position.x) / 2,
      height / 2,
      (inner.position.z + outer.position.z) / 2,
    );
    wall.rotation.y = inner.heading;
    group.add(wall);
  };
  for (const edge of [start, end]) {
    endWall(edge, TERRACE_FRONT, concourseFront, terraceTop + 0.4);
    endWall(edge, concourseFront, bowlBack, bowlTop + 0.8);
    endWall(edge, bowlBack, buildingBack, buildingTop);
  }

  // Six floodlight masts already run six point lights. A weak device does not
  // get four more just to pick out faces it is barely drawing.
  if (theme.grandstand.litFacade && detail >= 0.5) {
    // Four, not one per bay: every point light is per-fragment work, and the
    // floodlight masts already spend six of them.
    for (let index = 0; index < 4; index += 1) {
      const progress = start + ((index + 0.5) / 4) * (end - start);
      const sample = sampleCourse(progress, -(bowlFront + 3), distanceM);
      const light = new THREE.PointLight(0xffe6bd, 4_200, 130, 2);
      light.position.set(sample.position.x, roofY - 3, sample.position.z);
      group.add(light);
    }
  }

  return {
    group,
    update(elapsedMs: number, excitement: number, focusProgress: number): void {
      // Course progress into stand coordinates. The stand straddles the wrap at
      // the post, so anything before its start belongs to the next lap round.
      const wrapped = focusProgress < start ? focusProgress + 1 : focusProgress;
      crowd.update(elapsedMs, excitement, (wrapped - start) / (end - start));
    },
  };
}

function estimatedCrowd(rows: readonly CrowdRow[], lengthM: number): number {
  return Math.max(
    1,
    rows.reduce((total, row) => total + (lengthM / SEAT_SPACING_M) * row.density, 0),
  );
}
