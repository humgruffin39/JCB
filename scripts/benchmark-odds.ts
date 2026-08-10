import { createCalibrationReport } from '@jcb/odds';
import { horseFixture } from '@jcb/test-support';
import { performance } from 'node:perf_hooks';
import { WorkerProbabilityGenerator } from '../apps/server/src/worker-probability-generator.js';

const input = {
  raceId: 'benchmark-race',
  raceVersion: 1,
  distanceM: 1_600,
  surface: 'turf' as const,
  entries: Array.from({ length: 8 }, (_, index) => ({
    horseNumber: index + 1,
    condition: 'normal' as const,
    tieBreaker: (index + 1) / 10,
    horse: horseFixture(index + 1, {
      speed: 44 + index * 4,
      acceleration: 48 + index * 2,
      stamina: 62 - index,
      lateKick: 45 + index * 3,
    }),
  })),
};

const baselineRss = process.memoryUsage().rss;
let peakRss = baselineRss;
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 20);
const started = performance.now();
const result = await new WorkerProbabilityGenerator().generate(input, 'benchmark-odds-seed-v1');
const elapsedMilliseconds = performance.now() - started;
clearInterval(sampler);
peakRss = Math.max(peakRss, process.memoryUsage().rss);
const memoryIncreaseBytes = Math.max(0, peakRss - baselineRss);

const metrics = {
  measuredAt: new Date().toISOString(),
  nodeVersion: process.version,
  platform: `${process.platform}-${process.arch}`,
  simulationCount: result.simulationCount,
  elapsedMilliseconds: Math.round(elapsedMilliseconds),
  memoryIncreaseBytes,
  timeRequirementPassed: elapsedMilliseconds < 90_000,
  memoryRequirementPassed: memoryIncreaseBytes < 100 * 1_024 * 1_024,
};

process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n\n${createCalibrationReport(result)}\n`);
if (!metrics.timeRequirementPassed || !metrics.memoryRequirementPassed) {
  process.exitCode = 1;
}
