import {
  createOpaqueToken,
  deriveResultKey,
  deriveTimelineKey,
  encryptAesGcm,
  sha256,
  signReleaseManifest,
  type EncryptedPayload,
  type SignedManifest,
} from './result-secrecy.js';
import {
  allocateSeedLiquidity,
  generateProbabilities,
  INITIAL_SEED_LIQUIDITY,
  type ProbabilityResult,
  type SeedLiquidity,
  type SeedPositionAllocation,
} from '@jcb/odds';
import {
  encodeTimeline,
  SIMULATION_VERSION,
  TIMELINE_CODEC_VERSION,
  simulateOfficialRace,
  type OfficialSimulationResult,
  type SimulationInput,
} from '@jcb/simulation';
import type { Money, RaceKind, Timestamp } from '@jcb/domain';

export interface RacePreparationStart {
  readonly raceId: string;
  readonly raceVersion: number;
  readonly raceKind: RaceKind;
  readonly scheduledAt: Timestamp;
  readonly input: SimulationInput;
  readonly officialSeed: string;
  readonly oddsSeed: string;
}

export interface RacePreparationCompletion {
  readonly official: OfficialSimulationResult;
  readonly probabilities: ProbabilityResult;
  readonly encryptedResult: EncryptedPayload;
  readonly timelineCiphertext: Uint8Array;
  readonly timelineObjectKey: string;
  readonly timelineSha256: string;
  readonly signedManifest: SignedManifest;
  readonly winLiquidity: Money;
  readonly trifectaLiquidity: Money;
  readonly winPositions: readonly SeedPositionAllocation[];
  readonly trifectaPositions: readonly SeedPositionAllocation[];
}

export interface RacePreparationRepository {
  begin(raceId: string): RacePreparationStart;
  complete(start: RacePreparationStart, completion: RacePreparationCompletion): void;
  fail(raceId: string, errorCode: string, redactedMessage: string): void;
}

export interface ProbabilityGenerator {
  generate(input: SimulationInput, oddsSeed: string): Promise<ProbabilityResult>;
}

export interface PrepareRaceDependencies {
  readonly repository: RacePreparationRepository;
  readonly probabilityGenerator: ProbabilityGenerator;
  readonly timelineMasterSecret: string;
  readonly resultMasterSecret: string;
  readonly manifestPrivateKey: string;
  readonly seedLiquidity?: SeedLiquidity;
}

export async function prepareRace(
  raceId: string,
  dependencies: PrepareRaceDependencies,
): Promise<RacePreparationCompletion> {
  let start: RacePreparationStart | undefined;
  try {
    start = dependencies.repository.begin(raceId);
    const [official, probabilities] = await Promise.all([
      Promise.resolve(simulateOfficialRace(start.input, start.officialSeed)),
      dependencies.probabilityGenerator.generate(start.input, start.oddsSeed),
    ]);
    const resultKey = deriveResultKey(
      dependencies.resultMasterSecret,
      raceId,
      SIMULATION_VERSION,
      start.raceVersion,
    );
    const encryptedResult = encryptAesGcm(Buffer.from(JSON.stringify(official), 'utf8'), resultKey);
    const encodedTimeline = encodeTimeline(official.timeline);
    const timelineKey = deriveTimelineKey(
      dependencies.timelineMasterSecret,
      raceId,
      SIMULATION_VERSION,
      start.raceVersion,
    );
    const encryptedTimeline = encryptAesGcm(encodedTimeline, timelineKey);
    const timelineCiphertext = Buffer.from(encryptedTimeline.ciphertext, 'base64');
    const timelineSha256 = sha256(timelineCiphertext);
    const timelineObjectKey = `timelines/${raceId}/${createOpaqueToken()}.bin`;
    const signedManifest = signReleaseManifest(
      {
        raceId,
        raceVersion: start.raceVersion,
        scheduledStart: start.scheduledAt,
        timelineDuration: official.timelineDurationMs,
        ciphertextObjectKey: timelineObjectKey,
        ciphertextSha256: timelineSha256,
        codecVersion: TIMELINE_CODEC_VERSION,
        simulationVersion: SIMULATION_VERSION,
        iv: encryptedTimeline.iv,
        authTag: encryptedTimeline.authTag,
      },
      dependencies.manifestPrivateKey,
    );
    const liquidity = dependencies.seedLiquidity ?? INITIAL_SEED_LIQUIDITY[start.raceKind];
    const completion: RacePreparationCompletion = {
      official,
      probabilities,
      encryptedResult,
      timelineCiphertext,
      timelineObjectKey,
      timelineSha256,
      signedManifest,
      winLiquidity: liquidity.win,
      trifectaLiquidity: liquidity.trifecta,
      winPositions: allocateSeedLiquidity(liquidity.win, probabilities.win),
      trifectaPositions: allocateSeedLiquidity(liquidity.trifecta, probabilities.trifecta),
    };
    dependencies.repository.complete(start, completion);
    return completion;
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 300) : 'Unknown preparation error';
    if (start !== undefined) {
      dependencies.repository.fail(raceId, 'RACE_PREPARATION_FAILED', message);
    }
    throw error;
  }
}

export const directProbabilityGenerator: ProbabilityGenerator = {
  async generate(input, oddsSeed) {
    return generateProbabilities(input, oddsSeed);
  },
};
