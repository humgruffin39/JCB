import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createFinishSign } from './race-environment.js';

describe('race finish sign', () => {
  it('keeps the lettering readable on both sides of the board', () => {
    const texture = new THREE.Texture();
    const sign = createFinishSign(texture);
    const spectatorFace = sign.getObjectByName('finish-sign-spectator-face');
    const infieldFace = sign.getObjectByName('finish-sign-infield-face');

    expect(spectatorFace).toBeInstanceOf(THREE.Mesh);
    expect(infieldFace).toBeInstanceOf(THREE.Mesh);
    const spectatorMesh = spectatorFace as THREE.Mesh;
    const infieldMesh = infieldFace as THREE.Mesh;
    expect(spectatorMesh.rotation.y).toBeCloseTo(Math.PI);
    expect(infieldMesh.rotation.y).toBeCloseTo(0);
    expect(spectatorMesh.position.z).toBeLessThan(infieldMesh.position.z);
    expect((spectatorMesh.material as THREE.MeshStandardMaterial).side).toBe(THREE.FrontSide);
    expect((infieldMesh.material as THREE.MeshStandardMaterial).side).toBe(THREE.FrontSide);
  });
});
