import { z } from 'zod';

const discordId = z.string().regex(/^\d+$/);
const emptyAsUndefined = (value: unknown): unknown => (value === '' ? undefined : value);
const optionalSecret = z.preprocess(emptyAsUndefined, z.string().min(1).optional());
const optionalPem = z.preprocess(
  emptyAsUndefined,
  z
    .string()
    .min(1)
    .transform((value) => value.replaceAll('\\n', '\n'))
    .optional(),
);
const optionalDiscordId = z.preprocess(emptyAsUndefined, discordId.optional());
const optionalUrl = z.preprocess(emptyAsUndefined, z.url().optional());

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_PATH: z.string().min(1).default('./data/jcb.sqlite'),
  PUBLIC_WEB_ORIGIN: z.url().default('http://localhost:5173'),
  DISCORD_GUILD_ID: optionalDiscordId,
  DISCORD_BOT_TOKEN: optionalSecret,
  DISCORD_CLIENT_ID: optionalDiscordId,
  DISCORD_CLIENT_SECRET: optionalSecret,
  DISCORD_REDIRECT_URI: optionalUrl,
  DISCORD_RACE_CHANNEL_ID: optionalDiscordId,
  DISCORD_RANKING_CHANNEL_ID: optionalDiscordId,
  DISCORD_ADMIN_CHANNEL_ID: optionalDiscordId,
  INITIAL_ADMIN_DISCORD_IDS: z.string().default(''),
  SESSION_SECRET: optionalSecret,
  TIMELINE_MASTER_SECRET: optionalSecret,
  RESULT_MASTER_SECRET: optionalSecret,
  EDGE_TOKEN_PRIVATE_KEY: optionalPem,
  EDGE_TOKEN_PUBLIC_KEY: optionalPem,
  MANIFEST_PRIVATE_KEY: optionalPem,
  MANIFEST_PUBLIC_KEY: optionalPem,
  R2_ACCOUNT_ID: optionalSecret,
  R2_ACCESS_KEY_ID: optionalSecret,
  R2_SECRET_ACCESS_KEY: optionalSecret,
  R2_TIMELINE_BUCKET: optionalSecret,
  R2_BACKUP_BUCKET: optionalSecret,
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(source: NodeJS.ProcessEnv): Environment {
  const parsed = environmentSchema.parse(source);
  if (parsed.NODE_ENV === 'production') {
    const required = [
      'DISCORD_GUILD_ID',
      'DISCORD_BOT_TOKEN',
      'DISCORD_CLIENT_ID',
      'DISCORD_CLIENT_SECRET',
      'DISCORD_REDIRECT_URI',
      'DISCORD_RACE_CHANNEL_ID',
      'DISCORD_ADMIN_CHANNEL_ID',
      'SESSION_SECRET',
      'TIMELINE_MASTER_SECRET',
      'RESULT_MASTER_SECRET',
      'EDGE_TOKEN_PRIVATE_KEY',
      'EDGE_TOKEN_PUBLIC_KEY',
      'MANIFEST_PRIVATE_KEY',
      'MANIFEST_PUBLIC_KEY',
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_TIMELINE_BUCKET',
      'R2_BACKUP_BUCKET',
    ] as const;
    for (const key of required) {
      if (parsed[key] === undefined) {
        throw new Error(`${key} is required in production.`);
      }
    }
    if (
      parsed.INITIAL_ADMIN_DISCORD_IDS.split(',')
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id)).length === 0
    ) {
      throw new Error('At least one INITIAL_ADMIN_DISCORD_IDS value is required in production.');
    }
    if (
      parsed.PUBLIC_WEB_ORIGIN.includes('localhost') ||
      parsed.PUBLIC_WEB_ORIGIN.includes('127.0.0.1')
    ) {
      throw new Error('PUBLIC_WEB_ORIGIN must be explicitly configured for production.');
    }
    if (
      !parsed.CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .includes(parsed.PUBLIC_WEB_ORIGIN)
    ) {
      throw new Error('CORS_ORIGINS must include PUBLIC_WEB_ORIGIN in production.');
    }
  }
  return parsed;
}

const timeOfDay = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);

export const gameSettingsSchema = z
  .object({
    missingRaceWarningTime: timeOfDay,
    recommendedLockTime: timeOfDay,
    viewerOpenTime: timeOfDay,
    bettingCloseTime: timeOfDay,
    startTime: timeOfDay,
    conditionProbabilities: z
      .object({
        terrible: z.number().min(0).max(1),
        poor: z.number().min(0).max(1),
        normal: z.number().min(0).max(1),
        good: z.number().min(0).max(1),
        excellent: z.number().min(0).max(1),
      })
      .strict(),
    simulationNoiseStandardDeviation: z.number().min(0).max(0.1),
    fatigueMaximum: z.number().min(0).max(0.3),
    seedLiquidityClamp: z
      .object({
        regular: z
          .object({
            winMinimum: z.number().int().min(0).max(1_000_000),
            winMaximum: z.number().int().min(0).max(1_000_000),
            trifectaMinimum: z.number().int().min(0).max(1_000_000),
            trifectaMaximum: z.number().int().min(0).max(1_000_000),
          })
          .strict(),
        special: z
          .object({
            winMinimum: z.number().int().min(0).max(1_000_000),
            winMaximum: z.number().int().min(0).max(1_000_000),
            trifectaMinimum: z.number().int().min(0).max(1_000_000),
            trifectaMaximum: z.number().int().min(0).max(1_000_000),
          })
          .strict(),
      })
      .strict(),
    raceBetLimits: z
      .object({
        regular: z.number().int().min(100).max(1_000_000),
        midweek: z.number().int().min(100).max(1_000_000),
        saturday_night: z.number().int().min(100).max(1_000_000),
      })
      .strict(),
    discordOddsUpdateMilliseconds: z.number().int().min(10_000).max(120_000),
    webOddsPollMilliseconds: z.number().int().min(5_000).max(60_000),
    backupRetentionDays: z.number().int().min(1).max(90),
    visualEffectStrength: z.number().min(0).max(1),
    soundVolume: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((settings, context) => {
    const probability = Object.values(settings.conditionProbabilities).reduce(
      (sum, value) => sum + value,
      0,
    );
    if (Math.abs(probability - 1) > 1e-9) {
      context.addIssue({
        code: 'custom',
        path: ['conditionProbabilities'],
        message: 'Condition probabilities must sum to 1.',
      });
    }
    for (const [kind, clamp] of Object.entries(settings.seedLiquidityClamp)) {
      if (clamp.winMinimum > clamp.winMaximum || clamp.trifectaMinimum > clamp.trifectaMaximum) {
        context.addIssue({
          code: 'custom',
          path: ['seedLiquidityClamp', kind],
          message: 'Seed liquidity minimum must not exceed maximum.',
        });
      }
    }
  });

export type GameSettings = z.infer<typeof gameSettingsSchema>;

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  missingRaceWarningTime: '17:00:00',
  recommendedLockTime: '18:00:00',
  viewerOpenTime: '21:55:00',
  bettingCloseTime: '21:59:30',
  startTime: '22:00:00',
  conditionProbabilities: {
    terrible: 0.1,
    poor: 0.2,
    normal: 0.4,
    good: 0.2,
    excellent: 0.1,
  },
  simulationNoiseStandardDeviation: 0.022,
  fatigueMaximum: 0.12,
  seedLiquidityClamp: {
    regular: {
      winMinimum: 5_000,
      winMaximum: 25_000,
      trifectaMinimum: 10_000,
      trifectaMaximum: 40_000,
    },
    special: {
      winMinimum: 10_000,
      winMaximum: 50_000,
      trifectaMinimum: 20_000,
      trifectaMaximum: 80_000,
    },
  },
  raceBetLimits: {
    regular: 5_000,
    midweek: 10_000,
    saturday_night: 20_000,
  },
  discordOddsUpdateMilliseconds: 30_000,
  webOddsPollMilliseconds: 15_000,
  backupRetentionDays: 30,
  visualEffectStrength: 0.6,
  soundVolume: 0.5,
};

export function renderLitestreamConfig(template: string, retentionDays: number): string {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) {
    throw new Error('Litestream retention must be an integer from 1 through 90 days.');
  }
  const retentionPattern = /^(\s*)retention:\s*720h\s*$/gm;
  const matches = [...template.matchAll(retentionPattern)];
  if (matches.length !== 1) {
    throw new Error('Litestream template must contain exactly one snapshot retention marker.');
  }
  return template.replace(
    retentionPattern,
    `${matches[0]?.[1] ?? ''}retention: ${retentionDays * 24}h`,
  );
}

export function parseBackupRetentionDays(persistedSettings: unknown): number {
  const parsed = z
    .object({
      backupRetentionDays: z.number().int().min(1).max(90).optional(),
    })
    .passthrough()
    .parse(persistedSettings);
  return parsed.backupRetentionDays ?? DEFAULT_GAME_SETTINGS.backupRetentionDays;
}
