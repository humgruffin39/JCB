import type { RaceEntry, Surface } from '@jcb/domain';

export interface SimulationInput {
  readonly raceId: string;
  readonly raceVersion: number;
  readonly distanceM: number;
  readonly surface: Surface;
  readonly entries: readonly RaceEntry[];
  readonly noiseStandardDeviation?: number;
  readonly fatigueMaximum?: number;
}

export interface TimelineHorseFrame {
  readonly horseNumber: number;
  readonly progress: number;
  readonly laneIndex: number;
  readonly lateralOffset: number;
  readonly rank: number;
  readonly speed: number;
  readonly animationState: 'waiting' | 'running' | 'finished';
}

export interface TimelineFrame {
  readonly timeMs: number;
  readonly horses: readonly TimelineHorseFrame[];
}

export interface FinishResult {
  readonly horseNumber: number;
  readonly position: number;
  readonly finishTimeMs: number;
}

export interface OfficialSimulationResult {
  readonly prngVersion: string;
  readonly simulationVersion: string;
  readonly inputHash: string;
  readonly resultHash: string;
  readonly timelineDurationMs: number;
  readonly finishOrder: readonly FinishResult[];
  readonly timeline: readonly TimelineFrame[];
}

export interface SimulationRunResult {
  readonly finishOrder: readonly FinishResult[];
  readonly timeline: readonly TimelineFrame[];
  readonly timelineDurationMs: number;
}
