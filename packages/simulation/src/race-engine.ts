import {
  CONDITION_LEVELS,
  distancePreferenceScore,
  surfacePreferenceScore,
  validateRaceEntries,
  type RaceEntry,
} from '@jcb/domain';
import { truncatedNormal, uniform, type DeterministicPrng } from './prng.js';
import { SIMULATION_TICK_SECONDS, TIMELINE_SAMPLE_TICKS } from './simulation-config.js';
import type { SimulationInput, SimulationRunResult, TimelineFrame } from './simulation-types.js';

interface EffectiveHorse {
  readonly entry: RaceEntry;
  readonly topSpeed: number;
  readonly acceleration: number;
  readonly enduranceSeconds: number;
  readonly startDelaySeconds: number;
  readonly closerTrigger: number;
  readonly paceAmplitude: number;
  readonly paceFrequency: number;
  readonly pacePhase: number;
  readonly lateKickMaximum: number;
  readonly lateralOffset: number;
  readonly fatigueMaximum: number;
}

interface HorseState {
  readonly effective: EffectiveHorse;
  distance: number;
  speed: number;
  remainingStamina: number;
  finishTimeSeconds: number | undefined;
}

export function validateSimulationInput(input: SimulationInput): void {
  validateRaceEntries(input.entries);
  if (!Number.isInteger(input.distanceM) || input.distanceM <= 0) {
    throw new Error('Distance must be a positive integer.');
  }
  if (
    input.noiseStandardDeviation !== undefined &&
    (!Number.isFinite(input.noiseStandardDeviation) ||
      input.noiseStandardDeviation < 0 ||
      input.noiseStandardDeviation > 0.1)
  ) {
    throw new Error('Noise standard deviation must be between 0 and 0.1.');
  }
  if (
    input.fatigueMaximum !== undefined &&
    (!Number.isFinite(input.fatigueMaximum) ||
      input.fatigueMaximum < 0 ||
      input.fatigueMaximum > 0.3)
  ) {
    throw new Error('Maximum fatigue must be between 0 and 0.3.');
  }
}

export function runSimulation(
  input: SimulationInput,
  prng: DeterministicPrng,
  includeTimeline: boolean,
  validateInput = true,
): SimulationRunResult {
  if (validateInput) validateSimulationInput(input);
  const states: HorseState[] = input.entries.map((entry) => ({
    effective: createEffectiveHorse(entry, input, prng),
    distance: 0,
    speed: 0,
    remainingStamina: 1,
    finishTimeSeconds: undefined,
  }));
  const timeline: TimelineFrame[] = [];
  let tick = 0;
  let remainingHorses = states.length;
  // A valid 5,000 m race with minimum abilities can legitimately take over six minutes.
  // Five metres per second is below the model's slowest bounded forward pace.
  const maximumDurationSeconds = Math.max(360, input.distanceM / 5 + 10);
  const maximumTicks = Math.ceil(maximumDurationSeconds / SIMULATION_TICK_SECONDS);
  if (includeTimeline) timeline.push(createTimelineFrame(states, input.distanceM, 0));

  while (remainingHorses > 0) {
    if (tick >= maximumTicks) throw new Error('Simulation exceeded its distance safety limit.');
    const currentTime = tick * SIMULATION_TICK_SECONDS;
    for (const state of states) {
      if (state.finishTimeSeconds !== undefined) continue;
      updateHorse(state, input.distanceM, currentTime);
      if (state.finishTimeSeconds !== undefined) remainingHorses -= 1;
    }
    tick += 1;
    if (includeTimeline && tick % TIMELINE_SAMPLE_TICKS === 0) {
      timeline.push(
        createTimelineFrame(states, input.distanceM, tick * SIMULATION_TICK_SECONDS * 1000),
      );
    }
  }

  const ordered = [...states].sort((left, right) => {
    const timeDifference = left.finishTimeSeconds! - right.finishTimeSeconds!;
    if (timeDifference !== 0) return timeDifference;
    return left.effective.entry.tieBreaker - right.effective.entry.tieBreaker;
  });
  const finishOrder = ordered.map((state, index) => ({
    horseNumber: state.effective.entry.horseNumber,
    position: index + 1,
    finishTimeMs: Math.round(state.finishTimeSeconds! * 1000),
  }));
  const timelineDurationMs = Math.max(...finishOrder.map((finish) => finish.finishTimeMs));
  return { finishOrder, timeline, timelineDurationMs };
}

function createEffectiveHorse(
  entry: RaceEntry,
  input: SimulationInput,
  prng: DeterministicPrng,
): EffectiveHorse {
  const noiseStandardDeviation = input.noiseStandardDeviation ?? 0.022;
  const conditionDelta =
    0.08 * (CONDITION_LEVELS[entry.condition] / 2) * (1 - entry.horse.conditionStability / 100);
  const speed = entry.horse.speed * (1 + conditionDelta);
  const acceleration = entry.horse.acceleration * (1 + conditionDelta * 0.5);
  const stamina = entry.horse.stamina * (1 + conditionDelta * 0.75);
  const lateKick = entry.horse.lateKick * (1 + conditionDelta * 0.5);
  const start = entry.horse.start * (1 + conditionDelta * 0.25);
  const distanceScore = distancePreferenceScore(entry.horse, input.distanceM);
  const surfaceScore = surfacePreferenceScore(entry.horse, input.surface);
  const topSpeedMultiplier = clamp(1 + 0.05 * distanceScore + 0.03 * surfaceScore, 0.85, 1.15);
  const enduranceMultiplier = clamp(1 + 0.12 * distanceScore + 0.05 * surfaceScore, 0.75, 1.25);
  const accelerationMultiplier = clamp(1 + 0.02 * surfaceScore, 0.85, 1.15);
  const runningEfficiency = 1 + truncatedNormal(prng, noiseStandardDeviation);
  const staminaEfficiency = 1 + truncatedNormal(prng, noiseStandardDeviation * 0.8);
  const accelerationEfficiency = 1 + truncatedNormal(prng, noiseStandardDeviation * 0.7);
  return {
    entry,
    topSpeed: (15.8 + (3 * speed) / 100) * topSpeedMultiplier * runningEfficiency,
    acceleration:
      (1.8 + (2 * acceleration) / 100) * accelerationMultiplier * accelerationEfficiency,
    enduranceSeconds: (70 + (85 * stamina) / 100) * enduranceMultiplier * staminaEfficiency,
    startDelaySeconds: 0.75 - (0.6 * start) / 100 + uniform(prng, -0.06, 0.06),
    closerTrigger: uniform(prng, 0.66, 0.79),
    paceAmplitude: truncatedNormal(prng, noiseStandardDeviation * 0.22),
    paceFrequency: uniform(prng, 0.018, 0.035),
    pacePhase: uniform(prng, 0, Math.PI * 2),
    lateKickMaximum: 0.015 + (0.05 * lateKick) / 100,
    lateralOffset: uniform(prng, -0.18, 0.18),
    fatigueMaximum: input.fatigueMaximum ?? 0.12,
  };
}

function updateHorse(state: HorseState, distanceM: number, currentTime: number): void {
  const horse = state.effective;
  if (currentTime < horse.startDelaySeconds) return;
  const progress = clamp(state.distance / distanceM, 0, 1);
  const isCloser = horse.entry.horse.runningStyle === 'closer';
  const styleEffort = isCloser
    ? progress < horse.closerTrigger
      ? 0.94
      : 1.01
    : progress < 0.6
      ? 1
      : 0.98;
  const kickProgress =
    progress <= horse.closerTrigger
      ? 0
      : (progress - horse.closerTrigger) / (1 - horse.closerTrigger);
  const lateKickBonus =
    horse.lateKickMaximum * kickProgress * (0.4 + 0.6 * clamp(state.remainingStamina, 0, 1));
  const fatiguePenalty =
    state.remainingStamina >= 0.4
      ? 0
      : horse.fatigueMaximum * (1 - clamp(state.remainingStamina / 0.4, 0, 1));
  const paceNoise =
    horse.paceAmplitude *
    Math.sin(currentTime * horse.paceFrequency * Math.PI * 2 + horse.pacePhase);
  const targetSpeed = Math.max(
    0,
    horse.topSpeed * (styleEffort + lateKickBonus - fatiguePenalty + paceNoise),
  );
  if (state.speed < targetSpeed) {
    state.speed = Math.min(targetSpeed, state.speed + horse.acceleration * SIMULATION_TICK_SECONDS);
  } else {
    state.speed = Math.max(targetSpeed, state.speed - 1.4 * SIMULATION_TICK_SECONDS);
  }
  const speedRatio = state.speed / horse.topSpeed;
  const frontRunnerDrain =
    horse.entry.horse.runningStyle === 'front_runner' && progress < 0.6 ? 1.025 : 1;
  const drain =
    (SIMULATION_TICK_SECONDS * speedRatio ** 3 * frontRunnerDrain) / horse.enduranceSeconds;
  state.remainingStamina = Math.max(0, state.remainingStamina - drain);
  const previousDistance = state.distance;
  state.distance += state.speed * SIMULATION_TICK_SECONDS;
  if (state.distance >= distanceM) {
    const crossedDistance = distanceM - previousDistance;
    const fraction =
      state.speed === 0 ? 1 : crossedDistance / (state.speed * SIMULATION_TICK_SECONDS);
    state.finishTimeSeconds = currentTime + clamp(fraction, 0, 1) * SIMULATION_TICK_SECONDS;
    state.distance = distanceM;
  }
}

function createTimelineFrame(
  states: readonly HorseState[],
  distanceM: number,
  timeMs: number,
): TimelineFrame {
  const rank = new Map(
    [...states]
      .sort((left, right) => right.distance - left.distance || right.speed - left.speed)
      .map((state, index) => [state.effective.entry.horseNumber, index + 1]),
  );
  return {
    timeMs: Math.round(timeMs),
    horses: states
      .map((state) => ({
        horseNumber: state.effective.entry.horseNumber,
        progress: clamp(state.distance / distanceM, 0, 1),
        laneIndex: state.effective.entry.horseNumber - 1,
        lateralOffset: state.effective.lateralOffset,
        rank: rank.get(state.effective.entry.horseNumber) ?? 8,
        speed: state.speed,
        animationState:
          state.finishTimeSeconds !== undefined
            ? ('finished' as const)
            : state.speed > 0
              ? ('running' as const)
              : ('waiting' as const),
      }))
      .sort((left, right) => left.horseNumber - right.horseNumber),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
