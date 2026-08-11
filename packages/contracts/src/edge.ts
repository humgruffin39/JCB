import { z } from 'zod';
import { timestampSchema } from './common.js';

export const edgeAccessClaimsSchema = z.object({
  raceId: z.string().min(1),
  discordUserId: z.string().min(1),
  guildId: z.string().min(1),
  nbf: z.number().int(),
  exp: z.number().int(),
  jti: z.string().min(1),
});

export const releaseManifestSchema = z.object({
  raceId: z.string().min(1),
  raceVersion: z.number().int().positive(),
  scheduledStart: timestampSchema,
  timelineDuration: z.number().int().positive(),
  ciphertextObjectKey: z.string().min(20),
  ciphertextSha256: z.string().regex(/^[a-f0-9]{64}$/),
  codecVersion: z.string().min(1),
  simulationVersion: z.string().min(1),
  iv: z.string().min(16),
  authTag: z.string().min(16),
});

export const signedManifestSchema = z.object({
  manifest: releaseManifestSchema,
  signature: z.string().min(20),
});

export const edgeReleaseSchema = z.object({
  raceId: z.string().min(1),
  raceVersion: z.number().int().positive(),
  scheduledStart: timestampSchema,
  timelineDuration: z.number().int().positive(),
  timelineKey: z.string().min(16),
  iv: z.string().min(16),
  authTag: z.string().min(16),
  codecVersion: z.literal('json-gzip-v1'),
  timelinePath: z.string().startsWith('/edge/v1/races/'),
});

export const edgeReleaseResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  result: edgeReleaseSchema,
});

export const timelineHorseFrameSchema = z.object({
  horseNumber: z.number().int().min(1).max(8),
  progress: z.number().min(0).max(1),
  laneIndex: z.number().int().min(0).max(7),
  lateralOffset: z.number(),
  rank: z.number().int().min(1).max(8),
  speed: z.number().nonnegative(),
  animationState: z.enum(['waiting', 'running', 'finished']),
});

export const timelineFrameSchema = z.object({
  timeMs: z.number().int().nonnegative(),
  horses: z.array(timelineHorseFrameSchema).length(8),
});

export const timelineSchema = z.array(timelineFrameSchema).min(1);

export type EdgeRelease = z.infer<typeof edgeReleaseSchema>;
export type TimelineFrameContract = z.infer<typeof timelineFrameSchema>;
