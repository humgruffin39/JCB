import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createFinishSign, disposeRaceEnvironmentResources } from './race-environment.js';

describe('race finish sign', () => {
  it('letters the board on the course side and nowhere else', () => {
    const texture = new THREE.Texture();
    const sign = createFinishSign(texture);
    const infieldFace = sign.getObjectByName('finish-sign-infield-face');

    expect(sign.getObjectByName('finish-sign-spectator-face')).toBeUndefined();
    expect(infieldFace).toBeInstanceOf(THREE.Mesh);
    const infieldMesh = infieldFace as THREE.Mesh;
    expect(infieldMesh.rotation.y).toBeCloseTo(0);
    expect((infieldMesh.material as THREE.MeshStandardMaterial).side).toBe(THREE.FrontSide);
  });
});

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
