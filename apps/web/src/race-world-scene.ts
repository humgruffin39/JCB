import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { RaceEnvironment } from './race-environment.js';

export interface RaceWorldScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly sky: THREE.Mesh;
  readonly orbit: OrbitControls;
  readonly sun: THREE.DirectionalLight;
  readonly sunTarget: THREE.Object3D;
}

export function createRaceWorldScene(
  renderer: THREE.WebGLRenderer,
  environment: RaceEnvironment,
): RaceWorldScene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 800);
  scene.background = new THREE.Color(0x94b8c9);
  scene.fog = new THREE.Fog(0xa7bfbe, 140, 620);
  const sky = createSky();
  camera.add(sky);
  scene.add(camera, environment.group);

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.enablePan = false;
  orbit.screenSpacePanning = true;
  orbit.minDistance = 5;
  orbit.maxDistance = 420;
  orbit.minPolarAngle = 0.12;
  orbit.maxPolarAngle = Math.PI * 0.49;
  orbit.zoomToCursor = true;

  const hemisphere = new THREE.HemisphereLight(0xd7ecf1, 0x4c522e, 2.25);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xfff2d2, 3.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -12;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.00035;
  const sunTarget = new THREE.Object3D();
  sun.target = sunTarget;
  scene.add(sun, sunTarget);

  return { scene, camera, sky, orbit, sun, sunTarget };
}

function createSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(360, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x609abe) },
      horizonColor: { value: new THREE.Color(0xdbe5df) },
      bottomColor: { value: new THREE.Color(0x8ba67d) },
    },
    vertexShader: `
      varying vec3 vPosition;
      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      varying vec3 vPosition;
      void main() {
        float h = normalize(vPosition).y;
        vec3 color = h > 0.0
          ? mix(horizonColor, topColor, smoothstep(0.0, 0.72, h))
          : mix(horizonColor, bottomColor, smoothstep(0.0, -0.35, h));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geometry, material);
  sky.frustumCulled = false;
  return sky;
}
