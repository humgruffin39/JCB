import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  createHorseRig,
  loadHorseAssets,
  poseHorse,
  type HorseCoatColor,
} from './race-horse-model.js';

export function PodiumHorsePreview({
  horseNumber,
  coatColor,
}: {
  readonly horseNumber: number;
  readonly coatColor: HorseCoatColor;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    let disposed = false;
    let rig: ReturnType<typeof createHorseRig> | undefined;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    scene.add(new THREE.HemisphereLight(0xeaf6f7, 0x495137, 2.8));
    const keyLight = new THREE.DirectionalLight(0xfff0d4, 4.2);
    keyLight.position.set(-4, 7, 6);
    scene.add(keyLight);

    const render = () => {
      if (rig === undefined) return;
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;

      const box = new THREE.Box3().setFromObject(rig.root);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const distance =
        Math.max(
          size.y / (2 * Math.tan(verticalFov / 2)),
          size.x / (2 * Math.tan(horizontalFov / 2)),
        ) * 1.08;
      camera.position.set(center.x, center.y + size.y * 0.04, center.z + distance);
      camera.lookAt(center.x, center.y + size.y * 0.02, center.z);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };

    const resizeObserver = new ResizeObserver(render);
    resizeObserver.observe(canvas);

    void loadHorseAssets(renderer)
      .then((assets) => {
        if (disposed) return;
        rig = createHorseRig(assets, horseNumber, coatColor);
        poseHorse(rig, 1_450 + horseNumber * 47, 18, 'running');
        rig.root.updateMatrixWorld(true);
        scene.add(rig.root);
        render();
      })
      .catch((error: unknown) => {
        if (!disposed) console.error('Failed to render podium horse', error);
      });

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      if (rig !== undefined) {
        scene.remove(rig.root);
        rig.dispose();
      }
      renderer.dispose();
    };
  }, [coatColor, horseNumber]);

  return <canvas ref={canvasRef} className="podium-horse" aria-hidden="true" />;
}
