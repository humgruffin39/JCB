import * as THREE from 'three';
import { venueTheme, type VenueTheme } from './race-venue-theme.js';

export type RaceSurface = 'turf' | 'dirt';

export function createGroundTexture(
  renderer: THREE.WebGLRenderer,
  surface: RaceSurface,
  theme: VenueTheme = venueTheme('standard'),
): THREE.CanvasTexture {
  return createSurfaceTexture(renderer, surface, 'ground', theme);
}

export function createTrackTexture(
  renderer: THREE.WebGLRenderer,
  surface: RaceSurface,
  theme: VenueTheme = venueTheme('standard'),
): THREE.CanvasTexture {
  return createSurfaceTexture(renderer, surface, 'track', theme);
}

function createSurfaceTexture(
  renderer: THREE.WebGLRenderer,
  surface: RaceSurface,
  area: 'ground' | 'track',
  theme: VenueTheme,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('馬場テクスチャを作成できません');
  const dirt = surface === 'dirt';
  const palette = dirt ? theme.dirt : theme.turf;
  const base = area === 'ground' ? palette.ground : palette.track;
  context.fillStyle = `#${base.toString(16).padStart(6, '0')}`;
  context.fillRect(0, 0, 512, 512);
  // The speckle is drawn from the base colour so a darker venue keeps its grain
  // instead of turning into a flat panel.
  const speckle = {
    red: (base >> 16) & 0xff,
    green: (base >> 8) & 0xff,
    blue: base & 0xff,
  };
  let seed = dirt ? (area === 'ground' ? 0x2a6d4e91 : 0x4d3a9c17) : 0x7f4a7c15;
  const random = (): number => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0xffff_ffff;
  };
  context.lineWidth = 1;
  for (let index = 0; index < 13_000; index += 1) {
    const x = random() * 512;
    const y = random() * 512;
    const lift = 1 + (dirt ? 0.28 : 0.34) * random();
    const red = Math.min(255, Math.floor(speckle.red * lift));
    const green = Math.min(255, Math.floor(speckle.green * lift));
    const blue = Math.min(255, Math.floor(speckle.blue * lift));
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
