import * as THREE from 'three';
import {
  COURSE_RADIUS_Z,
  courseRadiusXForDistance,
  createOffsetCourseCurve,
  RACE_START_COURSE_PROGRESS,
  sampleCourse,
  TRACK_HALF_WIDTH,
} from './race-course.js';

const WHITE = 0xe8e7df;
const DARK_METAL = 0x26322c;
export type RaceSurface = 'turf' | 'dirt';

export class RaceEnvironment {
  readonly group = new THREE.Group();
  private readonly gateDoors: readonly THREE.Group[];
  private readonly ownedTextures: readonly THREE.Texture[];

  constructor(renderer: THREE.WebGLRenderer, distanceM = 1_200, surface: RaceSurface = 'turf') {
    const groundTexture = createGroundTexture(renderer, surface);
    const trackTexture = createTrackTexture(renderer, surface);
    const finishTexture = createFinishTexture(renderer);
    this.ownedTextures = [groundTexture, trackTexture, finishTexture];
    this.group.add(
      createTrack(groundTexture, trackTexture, distanceM),
      createRails(distanceM),
      createInfield(),
      createHorizon(distanceM),
      createClouds(distanceM),
    );
    const gate = createStartingGate();
    placeOnCourse(gate.group, RACE_START_COURSE_PROGRESS, 1.15, distanceM);
    this.gateDoors = gate.doors;
    const finish = createFinishStructure(finishTexture);
    placeOnCourse(finish, 0, 0, distanceM);
    this.group.add(gate.group, finish);
  }

  update(positionMs: number) {
    const opening = THREE.MathUtils.smoothstep(positionMs, 350, 850);
    this.gateDoors.forEach((door, index) => {
      const direction = index % 2 === 0 ? -1 : 1;
      door.rotation.y = direction * opening * Math.PI * 0.48;
    });
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const mesh = object as THREE.Mesh;
      geometries.add(mesh.geometry);
      const meshMaterials: readonly THREE.Material[] = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      meshMaterials.forEach((material) => materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.ownedTextures.forEach((texture) => texture.dispose());
  }
}

function createTrack(
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

function createRails(distanceM: number): THREE.Group {
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
  const postCount = postsPerRail * 2;
  const posts = new THREE.InstancedMesh(postGeometry, railMaterial, postCount);
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

function createStartingGate(): { readonly group: THREE.Group; readonly doors: THREE.Group[] } {
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

function createFinishStructure(labelTexture: THREE.Texture): THREE.Group {
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

function createInfield(): THREE.Group {
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

function createHorizon(distanceM: number): THREE.Group {
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

function createClouds(distanceM: number): THREE.Group {
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

function createGroundTexture(
  renderer: THREE.WebGLRenderer,
  surface: RaceSurface,
): THREE.CanvasTexture {
  return createSurfaceTexture(renderer, surface, 'ground');
}

function createTrackTexture(
  renderer: THREE.WebGLRenderer,
  surface: RaceSurface,
): THREE.CanvasTexture {
  return createSurfaceTexture(renderer, surface, 'track');
}

function createSurfaceTexture(
  renderer: THREE.WebGLRenderer,
  surface: RaceSurface,
  area: 'ground' | 'track',
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('馬場テクスチャを作成できません');
  const dirt = surface === 'dirt';
  context.fillStyle = dirt
    ? area === 'ground'
      ? '#59452e'
      : '#9a7045'
    : area === 'ground'
      ? '#4f6d31'
      : '#769a4d';
  context.fillRect(0, 0, 512, 512);
  let seed = dirt ? (area === 'ground' ? 0x2a6d4e91 : 0x4d3a9c17) : 0x7f4a7c15;
  const random = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0xffff_ffff;
  };
  context.lineWidth = 1;
  for (let index = 0; index < 13_000; index += 1) {
    const x = random() * 512;
    const y = random() * 512;
    const light = Math.floor((dirt ? 66 : 92) + random() * (dirt ? 38 : 42));
    const red = dirt ? Math.floor(light * 1.08) : Math.floor(light * 0.72);
    const green = dirt ? Math.floor(light * 0.78) : light;
    const blue = dirt ? Math.floor(light * 0.48) : Math.floor(light * 0.42);
    context.strokeStyle = `rgb(${String(red)} ${String(green)} ${String(blue)} / ${String(
      0.16 + random() * 0.24,
    )})`;
    context.beginPath();
    context.moveTo(x, y);
    const length = dirt ? 1.2 + random() * 2.4 : 2 + random() * 4;
    context.lineTo(x + (random() - 0.5) * length, y - length);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function placeOnCourse(
  object: THREE.Object3D,
  courseProgress: number,
  forwardOffset = 0,
  distanceM = 1_200,
): void {
  const sample = sampleCourse(courseProgress, 0, distanceM);
  object.position.copy(sample.position).addScaledVector(sample.tangent, forwardOffset);
  object.rotation.y = sample.heading;
}

function createFinishTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 144;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('ゴール表示を作成できません');
  context.fillStyle = '#f3f1e9';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#151615';
  context.font = '900 72px "Noto Sans JP Variable", "Noto Sans JP", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('FINISH', canvas.width / 2, canvas.height / 2 + 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}
