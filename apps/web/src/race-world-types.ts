import type { TimelineFrameContract } from '@jcb/contracts';
import type * as THREE from 'three';

export interface FinishPosition {
  readonly horseNumber: number;
  readonly position: number;
  readonly finishTimeMs: number;
}

export interface RaceWorldState {
  readonly frame: TimelineFrameContract;
  readonly positionMs: number;
  readonly finishOrder: readonly FinishPosition[];
  readonly isPhoto: boolean;
}

export type RaceCameraMode = 'follow' | 'horse';

export interface FinishSnapshotCamera {
  readonly cameraPosition: THREE.Vector3;
  readonly targetPosition: THREE.Vector3;
  readonly fieldOfView: number;
}
