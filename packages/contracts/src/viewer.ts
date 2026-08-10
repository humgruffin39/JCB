import { z } from 'zod';
import { moneyStringSchema, timestampSchema } from './common.js';

export const ticketExchangeSchema = z
  .object({
    ticket: z.string().min(40).max(200),
  })
  .strict();

export const discordOAuthCallbackSchema = z
  .object({
    code: z.string().min(1).max(512),
    state: z.string().min(32).max(512),
  })
  .strict();

export const publicRaceEntrySchema = z.object({
  horseNumber: z.number().int().min(1).max(8),
  horseId: z.string(),
  name: z.string(),
  runningStyle: z.enum(['front_runner', 'closer']),
  coatColor: z.enum(['black', 'chestnut', 'gray', 'cream']),
  condition: z.enum(['terrible', 'poor', 'normal', 'good', 'excellent']),
  baseWinOdds: z.string(),
  currentWinOdds: z.string(),
});

export const raceDetailSchema = z.object({
  id: z.string(),
  raceDate: z.string(),
  name: z.string(),
  kind: z.enum(['regular', 'midweek', 'saturday_night']),
  status: z.enum([
    'draft',
    'locked',
    'simulating',
    'betting_open',
    'betting_closed',
    'ready',
    'running',
    'finished',
    'settling',
    'settled',
    'cancelled',
    'failed',
  ]),
  version: z.number().int(),
  distanceM: z.number().int(),
  surface: z.enum(['turf', 'dirt']),
  scheduledAt: timestampSchema,
  bettingClosesAt: timestampSchema,
  viewerOpensAt: timestampSchema,
  entries: z.array(publicRaceEntrySchema).length(8),
  trifectaPoolTotal: moneyStringSchema,
  carryover: moneyStringSchema,
});

export const betResponseSchema = z.object({
  id: z.string(),
  poolType: z.enum(['win', 'trifecta']),
  selectionCode: z.string(),
  stake: moneyStringSchema,
  status: z.enum(['open', 'won', 'lost', 'refunded']),
  payout: moneyStringSchema,
  createdAt: timestampSchema,
});

export const resultResponseSchema = z.object({
  finishOrder: z.array(
    z.object({
      horseNumber: z.number().int().min(1).max(8),
      position: z.number().int().min(1).max(8),
      finishTimeMs: z.number().int().positive(),
    }),
  ),
});

export const publicSettingsSchema = z.object({
  recommendedLockTime: z.string(),
  viewerOpenTime: z.string(),
  bettingCloseTime: z.string(),
  startTime: z.string(),
  webOddsPollMilliseconds: z.number().int().min(5_000).max(60_000),
  visualEffectStrength: z.number().min(0).max(1),
  soundVolume: z.number().min(0).max(1),
});
