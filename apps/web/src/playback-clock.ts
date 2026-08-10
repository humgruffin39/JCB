export interface ClockSample {
  readonly roundTripMilliseconds: number;
  readonly offsetMilliseconds: number;
}

export function selectServerOffset(samples: readonly ClockSample[]): number {
  if (samples.length < 3) throw new Error('At least three clock samples are required.');
  const selected = [...samples]
    .sort((left, right) => left.roundTripMilliseconds - right.roundTripMilliseconds)
    .slice(0, 3);
  return selected.reduce((sum, sample) => sum + sample.offsetMilliseconds, 0) / selected.length;
}

export function synchronizedPosition(
  localNow: number,
  serverOffset: number,
  scheduledStart: number,
  duration: number,
): number {
  return Math.max(0, Math.min(duration, localNow + serverOffset - scheduledStart));
}
