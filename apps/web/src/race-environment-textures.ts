import * as THREE from 'three';

export type RaceSurface = 'turf' | 'dirt';

export function createGroundTexture(
  renderer: THREE.WebGLRenderer,
  surface: RaceSurface,
): THREE.CanvasTexture {
  return createSurfaceTexture(renderer, surface, 'ground');
}

export function createTrackTexture(
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
  const random = (): number => {
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

export function createFinishTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
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
