import { createHash, randomBytes } from 'node:crypto';

export const PRNG_VERSION = 'xoshiro128ss-v1';

export interface DeterministicPrng {
  next(): number;
  nextUint32(): number;
}

export class Xoshiro128StarStar implements DeterministicPrng {
  private readonly state: Uint32Array;

  public constructor(seed: string | Uint8Array) {
    const digest = createHash('sha256').update(seed).digest();
    this.state = new Uint32Array([
      digest.readUInt32LE(0),
      digest.readUInt32LE(4),
      digest.readUInt32LE(8),
      digest.readUInt32LE(12),
    ]);
    if (this.state.every((part) => part === 0)) this.state[0] = 1;
  }

  public nextUint32(): number {
    const state0 = this.state[0]!;
    const state1 = this.state[1]!;
    const state2 = this.state[2]!;
    const state3 = this.state[3]!;
    const result = Math.imul(rotateLeft(Math.imul(state1, 5), 7), 9) >>> 0;
    const temporary = state1 << 9;
    this.state[2] = (state2 ^ state0) >>> 0;
    this.state[3] = (state3 ^ state1) >>> 0;
    this.state[1] = (state1 ^ this.state[2]!) >>> 0;
    this.state[0] = (state0 ^ this.state[3]!) >>> 0;
    this.state[2] = (this.state[2]! ^ temporary) >>> 0;
    this.state[3] = rotateLeft(this.state[3]!, 11);
    return result;
  }

  public next(): number {
    return this.nextUint32() / 4_294_967_296;
  }
}

export interface SimulationSeedSet {
  readonly officialSeed: string;
  readonly oddsSeed: string;
}

export function generateSimulationSeeds(): SimulationSeedSet {
  return {
    officialSeed: randomBytes(32).toString('hex'),
    oddsSeed: randomBytes(32).toString('hex'),
  };
}

export function uniform(prng: DeterministicPrng, minimum: number, maximum: number): number {
  return minimum + (maximum - minimum) * prng.next();
}

export function truncatedNormal(
  prng: DeterministicPrng,
  standardDeviation: number,
  sigmaLimit = 3,
): number {
  const first = Math.max(prng.next(), Number.EPSILON);
  const second = prng.next();
  const standardNormal = Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  return clamp(standardNormal, -sigmaLimit, sigmaLimit) * standardDeviation;
}

function rotateLeft(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
