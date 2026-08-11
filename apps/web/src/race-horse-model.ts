import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const ASSET_ROOT = '/assets/race-3d';
const MODEL_URL = `${ASSET_ROOT}/horse-jockey.glb`;
const IDLE_START_FRAME = 242;
const IDLE_END_FRAME = 292;
const GALLOP_START_FRAME = 496;
const GALLOP_END_FRAME = 510;
// The FBX take is authored at 24 fps. Its converted GLB has a longer trailing
// bind-pose section, so deriving fps from the GLB duration points at idle data.
const SOURCE_FRAMES_PER_SECOND = 24;

const HORSE_TEXTURES = [
  'ArabianHorseTex_01.webp',
  'ArabianHorseTex_02.webp',
  'ArabianHorseTex_03.webp',
  'ArabianHorseTex_04.webp',
] as const;

export type HorseCoatColor = 'black' | 'chestnut' | 'gray' | 'cream';

const HORSE_TEXTURE_INDEX: Readonly<Record<HorseCoatColor, number>> = {
  black: 0,
  chestnut: 1,
  gray: 2,
  cream: 3,
};
const JOCKEY_TEXTURES = [
  'JockeyTexture_01.webp',
  'JockeyTexture_02.webp',
  'JockeyTexture_03.webp',
] as const;

export const SADDLECLOTH_COLORS = [
  { background: '#f4f1df', foreground: '#111111' },
  { background: '#161616', foreground: '#f8f8f2' },
  { background: '#a91e29', foreground: '#ffffff' },
  { background: '#1d4e94', foreground: '#ffffff' },
  { background: '#d5ad2e', foreground: '#111111' },
  { background: '#236b4d', foreground: '#ffffff' },
  { background: '#c96a25', foreground: '#ffffff' },
  { background: '#c7658c', foreground: '#ffffff' },
] as const;

interface LoadedHorseAssets {
  readonly source: THREE.Object3D;
  readonly idle: THREE.AnimationClip;
  readonly gallop: THREE.AnimationClip;
  readonly horseMaps: readonly THREE.Texture[];
  readonly jockeyMaps: readonly THREE.Texture[];
  readonly horseNormal: THREE.Texture;
  readonly jockeyNormal: THREE.Texture;
  readonly saddleMap: THREE.Texture;
  readonly saddleNormal: THREE.Texture;
  readonly bridleMap: THREE.Texture;
  readonly bridleNormal: THREE.Texture;
}

export interface HorseRig {
  readonly horseNumber: number;
  readonly root: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  readonly idle: THREE.AnimationAction;
  readonly gallop: THREE.AnimationAction;
  readonly phaseOffset: number;
  gallopTime: number;
  lastPosePositionMs: number | undefined;
  dispose(): void;
}

export type HorsePoseState = 'waiting' | 'running' | 'finishing';
export const FINISHING_BLEND_DURATION_MS = 1_200;

let assetsPromise: Promise<LoadedHorseAssets> | undefined;

export async function loadHorseAssets(renderer: THREE.WebGLRenderer): Promise<LoadedHorseAssets> {
  if (assetsPromise === undefined) {
    const pending = loadAssets(renderer);
    const retryable = pending.catch((error: unknown) => {
      if (assetsPromise === retryable) assetsPromise = undefined;
      throw error;
    });
    assetsPromise = retryable;
  }
  return assetsPromise;
}

export function createHorseRig(
  assets: LoadedHorseAssets,
  horseNumber: number,
  coatColor?: HorseCoatColor,
): HorseRig {
  const model = cloneSkeleton(assets.source);
  model.name = `horse-${String(horseNumber)}-model`;
  model.rotation.y = Math.PI / 2;
  model.scale.setScalar(1.55);

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const mesh = object as THREE.Mesh;
    object.castShadow = true;
    object.receiveShadow = true;
    const sourceMaterial: THREE.Material | undefined = Array.isArray(mesh.material)
      ? mesh.material[0]
      : mesh.material;
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0.02,
      side: sourceMaterial?.side ?? THREE.FrontSide,
    });
    const name = object.name.toLowerCase();
    if (name.includes('arab_horse')) {
      material.map =
        assets.horseMaps[
          coatColor === undefined
            ? (horseNumber - 1) % assets.horseMaps.length
            : HORSE_TEXTURE_INDEX[coatColor]
        ] ?? assets.horseMaps[0]!;
      material.normalMap = assets.horseNormal;
      material.normalScale.set(0.65, 0.65);
    } else if (name.includes('jokey')) {
      material.map =
        assets.jockeyMaps[(horseNumber - 1) % assets.jockeyMaps.length] ?? assets.jockeyMaps[0]!;
      material.normalMap = assets.jockeyNormal;
      material.normalScale.set(0.7, 0.7);
    } else if (name.includes('sadle')) {
      material.map = assets.saddleMap;
      material.normalMap = assets.saddleNormal;
    } else if (name.includes('bridle')) {
      material.map = assets.bridleMap;
      material.normalMap = assets.bridleNormal;
    }
    material.needsUpdate = true;
    mesh.material = material;
  });

  const saddleclothResources = addSaddlecloth(model, horseNumber);

  const root = new THREE.Group();
  root.name = `horse-${String(horseNumber)}`;
  root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const idle = mixer.clipAction(assets.idle);
  const gallop = mixer.clipAction(assets.gallop);
  idle.enabled = true;
  idle.setLoop(THREE.LoopRepeat, Infinity);
  idle.play();
  gallop.enabled = true;
  gallop.setLoop(THREE.LoopRepeat, Infinity);
  gallop.play();

  return {
    horseNumber,
    root,
    mixer,
    idle,
    gallop,
    phaseOffset: ((horseNumber * 37) % 17) / 17,
    gallopTime: 0,
    lastPosePositionMs: undefined,
    dispose() {
      mixer.stopAllAction();
      const materials = new Set<THREE.Material>();
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const mesh = object as THREE.Mesh;
        const meshMaterials: readonly THREE.Material[] = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        meshMaterials.forEach((material) => materials.add(material));
      });
      materials.forEach((material) => material.dispose());
      saddleclothResources?.geometry.dispose();
      saddleclothResources?.texture.dispose();
    },
  };
}

export function poseHorse(
  rig: HorseRig,
  positionMs: number,
  speed: number,
  state: HorsePoseState,
  finishingElapsedMs = 0,
): void {
  const gallopDuration = rig.gallop.getClip().duration;
  const rewound = rig.lastPosePositionMs !== undefined && positionMs + 100 < rig.lastPosePositionMs;
  if (rig.lastPosePositionMs === undefined || rewound) {
    rig.gallopTime = rig.phaseOffset * gallopDuration;
  } else {
    const deltaSeconds = Math.max(0, positionMs - rig.lastPosePositionMs) / 1_000;
    rig.gallopTime += deltaSeconds * gallopCadenceForSpeed(speed);
  }
  rig.lastPosePositionMs = positionMs;
  rig.gallop.time = THREE.MathUtils.euclideanModulo(rig.gallopTime, gallopDuration);
  const finishingBlend = state === 'finishing' ? finishingBlendForElapsedMs(finishingElapsedMs) : 0;
  rig.gallop.setEffectiveWeight(state === 'waiting' ? 0 : 1 - finishingBlend);
  const idleDuration = rig.idle.getClip().duration;
  rig.idle.time = THREE.MathUtils.euclideanModulo(
    positionMs / 2_800 + rig.phaseOffset * Math.min(0.18, idleDuration),
    idleDuration,
  );
  rig.idle.setEffectiveWeight(state === 'waiting' ? 1 : finishingBlend);
  rig.mixer.update(0);
}

export function finishingBlendForElapsedMs(finishingElapsedMs: number): number {
  return THREE.MathUtils.smoothstep(finishingElapsedMs, 0, FINISHING_BLEND_DURATION_MS);
}

export function gallopCadenceForSpeed(speed: number): number {
  return THREE.MathUtils.clamp(1.58 + (speed - 18.5) * 0.012, 1.5, 1.67);
}

function addSaddlecloth(
  model: THREE.Object3D,
  horseNumber: number,
): { readonly geometry: THREE.PlaneGeometry; readonly texture: THREE.CanvasTexture } | undefined {
  const pelvis = model.getObjectByName('bind_pelvis01');
  if (pelvis === undefined) return undefined;

  const texture = createSaddleclothTexture(horseNumber);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const geometry = new THREE.PlaneGeometry(0.4, 0.28, 5, 3);
  const cloth = new THREE.Group();
  cloth.name = `saddlecloth-${String(horseNumber)}`;

  for (const side of [-1, 1] as const) {
    const panel = new THREE.Mesh(geometry, material);
    panel.name = `saddlecloth-${String(horseNumber)}-${side < 0 ? 'left' : 'right'}`;
    panel.position.set(side * 0.29, 1.08, -0.03);
    panel.rotation.y = (side * Math.PI) / 2;
    panel.castShadow = true;
    cloth.add(panel);
  }
  model.add(cloth);
  model.updateMatrixWorld(true);
  pelvis.attach(cloth);
  return { geometry, texture };
}

function createSaddleclothTexture(horseNumber: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('ゼッケンを描画できません');
  const colors = SADDLECLOTH_COLORS[horseNumber - 1] ?? SADDLECLOTH_COLORS[0];
  context.fillStyle = colors.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = colors.foreground;
  context.lineWidth = 18;
  context.strokeRect(15, 15, canvas.width - 30, canvas.height - 30);
  context.fillStyle = colors.foreground;
  context.font = '900 250px "Noto Sans JP Variable", "Noto Sans JP", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(horseNumber), canvas.width / 2, canvas.height / 2 + 12);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

async function loadAssets(renderer: THREE.WebGLRenderer): Promise<LoadedHorseAssets> {
  await document.fonts.load('900 250px "Noto Sans JP Variable"');
  const gltfLoader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const [
    gltf,
    horseMaps,
    jockeyMaps,
    horseNormal,
    jockeyNormal,
    saddleMap,
    saddleNormal,
    bridleMap,
    bridleNormal,
  ] = await Promise.all([
    gltfLoader.loadAsync(MODEL_URL),
    Promise.all(HORSE_TEXTURES.map((name) => textureLoader.loadAsync(`${ASSET_ROOT}/${name}`))),
    Promise.all(JOCKEY_TEXTURES.map((name) => textureLoader.loadAsync(`${ASSET_ROOT}/${name}`))),
    textureLoader.loadAsync(`${ASSET_ROOT}/ArabianHorseNM.png`),
    textureLoader.loadAsync(`${ASSET_ROOT}/jockeyNM.png`),
    textureLoader.loadAsync(`${ASSET_ROOT}/SadleColor.webp`),
    textureLoader.loadAsync(`${ASSET_ROOT}/SadleNM.png`),
    textureLoader.loadAsync(`${ASSET_ROOT}/BridleColor.webp`),
    textureLoader.loadAsync(`${ASSET_ROOT}/BridleNM.png`),
  ]);

  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const texture of [...horseMaps, ...jockeyMaps, saddleMap, bridleMap]) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.anisotropy = maxAnisotropy;
  }
  for (const texture of [horseNormal, jockeyNormal, saddleNormal, bridleNormal]) {
    texture.flipY = false;
    texture.anisotropy = maxAnisotropy;
  }
  const sourceClip = gltf.animations[0];
  if (sourceClip === undefined) throw new Error('馬のギャロップアニメーションがありません');
  const gallop = THREE.AnimationUtils.subclip(
    sourceClip,
    'Gallop',
    GALLOP_START_FRAME,
    GALLOP_END_FRAME,
    SOURCE_FRAMES_PER_SECOND,
  );
  const idle = THREE.AnimationUtils.subclip(
    sourceClip,
    'Idle01',
    IDLE_START_FRAME,
    IDLE_END_FRAME,
    SOURCE_FRAMES_PER_SECOND,
  );

  return {
    source: gltf.scene,
    idle,
    gallop,
    horseMaps,
    jockeyMaps,
    horseNormal,
    jockeyNormal,
    saddleMap,
    saddleNormal,
    bridleMap,
    bridleNormal,
  };
}
