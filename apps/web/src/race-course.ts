import * as THREE from 'three';

export const TRACK_HALF_WIDTH = 6;
export const COURSE_STRAIGHT_HALF_LENGTH = 96;
export const COURSE_TURN_RADIUS = 58;
export const COURSE_RADIUS_X = COURSE_STRAIGHT_HALF_LENGTH + COURSE_TURN_RADIUS;
export const COURSE_RADIUS_Z = COURSE_TURN_RADIUS;
export const REFERENCE_DISTANCE_M = 1_200;
export const RACE_START_COURSE_PROGRESS = 0.06;
export const RACE_FINISH_COURSE_PROGRESS = 1;

const HALF_STRAIGHT_LENGTH = COURSE_STRAIGHT_HALF_LENGTH;
const FULL_STRAIGHT_LENGTH = COURSE_STRAIGHT_HALF_LENGTH * 2;
const HALF_TURN_LENGTH = Math.PI * COURSE_TURN_RADIUS;
export const COURSE_LENGTH = FULL_STRAIGHT_LENGTH * 2 + HALF_TURN_LENGTH * 2;
const courseLengthCache = new Map<number, number>([[REFERENCE_DISTANCE_M, COURSE_LENGTH]]);

export interface CourseSample {
  readonly position: THREE.Vector3;
  readonly tangent: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly heading: number;
}

export function courseScaleForDistance(distanceM = REFERENCE_DISTANCE_M): number {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return 1;
  return distanceM / REFERENCE_DISTANCE_M;
}

export function courseLengthForDistance(distanceM = REFERENCE_DISTANCE_M): number {
  const normalizedDistance =
    Number.isFinite(distanceM) && distanceM > 0 ? distanceM : REFERENCE_DISTANCE_M;
  const cached = courseLengthCache.get(normalizedDistance);
  if (cached !== undefined) return cached;

  const samples = 512;
  const scaleX = courseScaleForDistance(normalizedDistance);
  let length = 0;
  let previous = sampleCenterline(0, scaleX).position;
  for (let index = 1; index <= samples; index += 1) {
    const current = sampleCenterline(index / samples, scaleX).position;
    length += current.distanceTo(previous);
    previous = current;
  }
  courseLengthCache.set(normalizedDistance, length);
  return length;
}

export function courseRadiusXForDistance(distanceM = REFERENCE_DISTANCE_M): number {
  return COURSE_RADIUS_X * courseScaleForDistance(distanceM);
}

interface CenterlineSample {
  readonly position: THREE.Vector3;
  readonly tangent: THREE.Vector3;
  readonly turnAmount: number;
}

export function sampleCourse(
  courseProgress: number,
  lateralOffset = 0,
  distanceM = REFERENCE_DISTANCE_M,
): CourseSample {
  const centerline = sampleCenterline(courseProgress, courseScaleForDistance(distanceM));
  const normal = new THREE.Vector3(-centerline.tangent.z, 0, centerline.tangent.x);
  const position = centerline.position.addScaledVector(normal, lateralOffset);
  return {
    position,
    tangent: centerline.tangent,
    normal,
    heading: Math.atan2(-centerline.tangent.z, centerline.tangent.x),
  };
}

export function courseTurnAmount(courseProgress: number, distanceM = REFERENCE_DISTANCE_M): number {
  return sampleCenterline(courseProgress, courseScaleForDistance(distanceM)).turnAmount;
}

export function raceProgressToCourseProgress(
  progress: number,
  noseOffset = 0,
  distanceM = REFERENCE_DISTANCE_M,
): number {
  const courseLength = courseLengthForDistance(distanceM);
  const start = RACE_START_COURSE_PROGRESS - noseOffset / courseLength;
  const finish = RACE_FINISH_COURSE_PROGRESS - noseOffset / courseLength;
  return THREE.MathUtils.lerp(start, finish, progress);
}

export function createOffsetCourseCurve(
  offset: number,
  height: number,
  distanceM = REFERENCE_DISTANCE_M,
): THREE.Curve<THREE.Vector3> {
  return new OffsetCourseCurve(offset, height, distanceM);
}

function sampleCenterline(courseProgress: number, scaleX: number): CenterlineSample {
  let distance = THREE.MathUtils.euclideanModulo(courseProgress, 1) * COURSE_LENGTH;

  if (distance < HALF_STRAIGHT_LENGTH) {
    return straightSample(distance, -COURSE_TURN_RADIUS, 1, scaleX);
  }
  distance -= HALF_STRAIGHT_LENGTH;

  if (distance < HALF_TURN_LENGTH) {
    const angle = -Math.PI / 2 + distance / COURSE_TURN_RADIUS;
    return turnSample(COURSE_STRAIGHT_HALF_LENGTH, angle, distance, scaleX);
  }
  distance -= HALF_TURN_LENGTH;

  if (distance < FULL_STRAIGHT_LENGTH) {
    return straightSample(COURSE_STRAIGHT_HALF_LENGTH - distance, COURSE_TURN_RADIUS, -1, scaleX);
  }
  distance -= FULL_STRAIGHT_LENGTH;

  if (distance < HALF_TURN_LENGTH) {
    const angle = Math.PI / 2 + distance / COURSE_TURN_RADIUS;
    return turnSample(-COURSE_STRAIGHT_HALF_LENGTH, angle, distance, scaleX);
  }
  distance -= HALF_TURN_LENGTH;

  return straightSample(-COURSE_STRAIGHT_HALF_LENGTH + distance, -COURSE_TURN_RADIUS, 1, scaleX);
}

function straightSample(x: number, z: number, direction: -1 | 1, scaleX: number): CenterlineSample {
  return {
    position: new THREE.Vector3(x * scaleX, 0, z),
    tangent: new THREE.Vector3(direction, 0, 0),
    turnAmount: 0,
  };
}

function turnSample(
  centerX: number,
  angle: number,
  distanceIntoTurn: number,
  scaleX: number,
): CenterlineSample {
  const edgeBlendDistance = 18;
  const turnAmount = Math.min(
    THREE.MathUtils.smoothstep(distanceIntoTurn, 0, edgeBlendDistance),
    THREE.MathUtils.smoothstep(HALF_TURN_LENGTH - distanceIntoTurn, 0, edgeBlendDistance),
  );
  return {
    position: new THREE.Vector3(
      (centerX + Math.cos(angle) * COURSE_TURN_RADIUS) * scaleX,
      0,
      Math.sin(angle) * COURSE_TURN_RADIUS,
    ),
    tangent: new THREE.Vector3(-Math.sin(angle) * scaleX, 0, Math.cos(angle)).normalize(),
    turnAmount,
  };
}

class OffsetCourseCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly offset: number,
    private readonly height: number,
    private readonly distanceM: number,
  ) {
    super();
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const position = sampleCourse(t, this.offset, this.distanceM).position;
    return target.set(position.x, this.height, position.z);
  }
}
