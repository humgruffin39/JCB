import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { disposeRaceEnvironmentResources } from './race-environment.js';

describe('race environment resource disposal', () => {
  it('disposes shared geometry/material once and releases owned textures', () => {
    const group = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial();
    group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    const texture = new THREE.Texture();
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    const textureDispose = vi.spyOn(texture, 'dispose');

    disposeRaceEnvironmentResources(group, [texture]);

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
  });
});
