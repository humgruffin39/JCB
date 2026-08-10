import { z } from 'zod';
import { timestampSchema } from './common.js';

const ability = z.number().int().min(0).max(100);
const preference = z.number().int().min(-100).max(100);

export const horseInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    status: z.enum(['active', 'resting', 'retired']).default('active'),
    runningStyle: z.enum(['front_runner', 'closer']),
    coatColor: z.enum(['black', 'chestnut', 'gray', 'cream']).optional(),
    speed: ability,
    start: ability,
    acceleration: ability,
    stamina: ability,
    lateKick: ability,
    conditionStability: ability,
    distancePreference: preference,
    surfacePreference: preference,
  })
  .strict();

export const horsePatchSchema = horseInputSchema.partial().strict();

export const raceEntryInputSchema = z.object({
  horseId: z.string().min(1).max(80),
  horseNumber: z.number().int().min(1).max(8),
});

export const createRaceSchema = z
  .object({
    raceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    name: z.string().trim().min(1).max(100),
    kind: z.enum(['regular', 'midweek', 'saturday_night']).optional(),
    distanceM: z.number().int().min(800).max(5000),
    surface: z.enum(['turf', 'dirt']),
    scheduledAt: timestampSchema,
    bettingOpensAt: timestampSchema,
    bettingClosesAt: timestampSchema,
    viewerOpensAt: timestampSchema,
    entries: z.array(raceEntryInputSchema).length(8),
  })
  .strict()
  .superRefine((race, context) => {
    if (new Set(race.entries.map((entry) => entry.horseId)).size !== 8) {
      context.addIssue({ code: 'custom', message: 'Eight distinct horses are required.' });
    }
    if (new Set(race.entries.map((entry) => entry.horseNumber)).size !== 8) {
      context.addIssue({ code: 'custom', message: 'Horse numbers must be distinct.' });
    }
    if (
      race.bettingOpensAt >= race.bettingClosesAt ||
      race.bettingClosesAt > race.scheduledAt ||
      race.viewerOpensAt > race.scheduledAt
    ) {
      context.addIssue({ code: 'custom', message: 'Race schedule ordering is invalid.' });
    }
  });

export const racePatchSchema = z
  .object({
    raceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    name: z.string().trim().min(1).max(100).optional(),
    kind: z.enum(['regular', 'midweek', 'saturday_night']).optional(),
    distanceM: z.number().int().min(800).max(5000).optional(),
    surface: z.enum(['turf', 'dirt']).optional(),
    scheduledAt: timestampSchema.optional(),
    bettingOpensAt: timestampSchema.optional(),
    bettingClosesAt: timestampSchema.optional(),
    viewerOpensAt: timestampSchema.optional(),
    entries: z.array(raceEntryInputSchema).length(8).optional(),
  })
  .strict();

export const adminAdjustmentSchema = z
  .object({
    accountId: z.string().min(1).max(80),
    amount: z.string().regex(/^-?[1-9]\d*$/),
    reason: z.string().trim().min(3).max(300),
    idempotencyKey: z.string().min(8).max(120),
  })
  .strict();

export const cancellationSchema = z
  .object({
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

export const emergencyRevealSchema = z
  .object({
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
