import { generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  DEFAULT_GAME_SETTINGS,
  gameSettingsSchema,
  parseEnvironment,
  parseBackupRetentionDays,
  renderLitestreamConfig,
} from './index.js';

const edgeKeys = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const manifestKeys = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function validProductionEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PUBLIC_WEB_ORIGIN: 'https://race.example.test',
    CORS_ORIGINS: 'https://race.example.test,https://admin.example.test',
    DISCORD_GUILD_ID: '100000000000000001',
    DISCORD_BOT_TOKEN: 'bot-token',
    DISCORD_CLIENT_ID: '100000000000000002',
    DISCORD_CLIENT_SECRET: 'client-secret',
    DISCORD_REDIRECT_URI: 'https://api.example.test/api/v1/auth/discord/callback',
    DISCORD_RACE_CHANNEL_ID: '100000000000000003',
    DISCORD_RANKING_CHANNEL_ID: '100000000000000004',
    DISCORD_ADMIN_CHANNEL_ID: '100000000000000005',
    COUNT_CHANNEL_ID: '100000000000000007',
    COUNT_PENALTY_ROLE_ID: '100000000000000008',
    COUNT_FAILURE_EMOJI_ID: '100000000000000009',
    INITIAL_ADMIN_DISCORD_IDS: '100000000000000006',
    SESSION_SECRET: randomBytes(32).toString('base64'),
    TIMELINE_MASTER_SECRET: randomBytes(32).toString('base64'),
    RESULT_MASTER_SECRET: randomBytes(32).toString('base64'),
    EDGE_TOKEN_PRIVATE_KEY: edgeKeys.privateKey,
    EDGE_TOKEN_PUBLIC_KEY: edgeKeys.publicKey,
    MANIFEST_PRIVATE_KEY: manifestKeys.privateKey,
    MANIFEST_PUBLIC_KEY: manifestKeys.publicKey,
    R2_ACCOUNT_ID: 'r2-account',
    R2_ACCESS_KEY_ID: 'r2-access-key',
    R2_SECRET_ACCESS_KEY: 'r2-secret-key',
    R2_TIMELINE_BUCKET: 'timeline-bucket',
    R2_BACKUP_BUCKET: 'backup-bucket',
  };
}

describe('production environment', () => {
  it('accepts a complete non-local production configuration', () => {
    expect(parseEnvironment(validProductionEnvironment()).NODE_ENV).toBe('production');
  });

  it('rejects a missing integration secret', () => {
    const environment = validProductionEnvironment();
    delete environment.DISCORD_BOT_TOKEN;
    expect(() => parseEnvironment(environment)).toThrow(
      'DISCORD_BOT_TOKEN is required in production.',
    );
  });

  it('requires Counting Bot to be configured in production', () => {
    const environment = validProductionEnvironment();
    delete environment.COUNT_CHANNEL_ID;
    expect(() => parseEnvironment(environment)).toThrow(
      'COUNT_CHANNEL_ID is required in production.',
    );
  });

  it('requires counting resources together when counting is enabled', () => {
    const incompleteEnvironment = validProductionEnvironment();
    delete incompleteEnvironment.COUNT_PENALTY_ROLE_ID;
    expect(() =>
      parseEnvironment({
        ...incompleteEnvironment,
      }),
    ).toThrow('COUNT_PENALTY_ROLE_ID is required when COUNT_CHANNEL_ID is configured.');
    expect(
      parseEnvironment({
        ...validProductionEnvironment(),
        COUNT_CHANNEL_ID: '100000000000000007',
        COUNT_PENALTY_ROLE_ID: '100000000000000008',
        COUNT_FAILURE_EMOJI_ID: '100000000000000009',
        COUNT_INITIAL_COUNT: '144',
      }).COUNT_INITIAL_COUNT,
    ).toBe('144');
  });

  it('requires an initial administrator and an exact public CORS origin', () => {
    expect(() =>
      parseEnvironment({
        ...validProductionEnvironment(),
        INITIAL_ADMIN_DISCORD_IDS: '',
      }),
    ).toThrow('At least one INITIAL_ADMIN_DISCORD_IDS value is required in production.');
    expect(() =>
      parseEnvironment({
        ...validProductionEnvironment(),
        CORS_ORIGINS: 'https://admin.example.test',
      }),
    ).toThrow('CORS_ORIGINS must include PUBLIC_WEB_ORIGIN in production.');
  });

  it('rejects a localhost production origin', () => {
    expect(() =>
      parseEnvironment({
        ...validProductionEnvironment(),
        PUBLIC_WEB_ORIGIN: 'http://localhost:5173',
        CORS_ORIGINS: 'http://localhost:5173',
      }),
    ).toThrow('PUBLIC_WEB_ORIGIN must be explicitly configured for production.');
  });

  it('rejects weak secrets and mismatched signing keys', () => {
    expect(() =>
      parseEnvironment({
        ...validProductionEnvironment(),
        TIMELINE_MASTER_SECRET: 'too-short',
      }),
    ).toThrow('TIMELINE_MASTER_SECRET must be a base64-encoded secret of at least 32 bytes.');
    expect(() =>
      parseEnvironment({
        ...validProductionEnvironment(),
        MANIFEST_PUBLIC_KEY: edgeKeys.publicKey,
      }),
    ).toThrow('MANIFEST_PRIVATE_KEY and MANIFEST_PUBLIC_KEY must be a matching Ed25519 key pair.');
  });
});

describe('development environment', () => {
  it('restores escaped PEM newlines from one-line dotenv values', () => {
    const environment = parseEnvironment({
      EDGE_TOKEN_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\\nkey-body\\n-----END PRIVATE KEY-----\\n',
    });
    expect(environment.EDGE_TOKEN_PRIVATE_KEY).toBe(
      '-----BEGIN PRIVATE KEY-----\nkey-body\n-----END PRIVATE KEY-----\n',
    );
  });

  it('treats blank optional values from the example env file as unset', () => {
    const environment = parseEnvironment({
      NODE_ENV: 'development',
      DISCORD_GUILD_ID: '',
      DISCORD_BOT_TOKEN: '',
      DISCORD_CLIENT_ID: '',
      DISCORD_CLIENT_SECRET: '',
      DISCORD_REDIRECT_URI: '',
      R2_ACCOUNT_ID: '',
    });
    expect(environment.DISCORD_GUILD_ID).toBeUndefined();
    expect(environment.DISCORD_BOT_TOKEN).toBeUndefined();
    expect(environment.DISCORD_REDIRECT_URI).toBeUndefined();
    expect(environment.R2_ACCOUNT_ID).toBeUndefined();
  });
});

describe('game settings', () => {
  it('accepts the complete defaults', () => {
    expect(gameSettingsSchema.parse(DEFAULT_GAME_SETTINGS)).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it('rejects invalid probability totals and inverted seed clamps', () => {
    expect(
      gameSettingsSchema.safeParse({
        ...DEFAULT_GAME_SETTINGS,
        conditionProbabilities: {
          ...DEFAULT_GAME_SETTINGS.conditionProbabilities,
          normal: 0.5,
        },
      }).success,
    ).toBe(false);
    expect(
      gameSettingsSchema.safeParse({
        ...DEFAULT_GAME_SETTINGS,
        seedLiquidityClamp: {
          ...DEFAULT_GAME_SETTINGS.seedLiquidityClamp,
          regular: {
            ...DEFAULT_GAME_SETTINGS.seedLiquidityClamp.regular,
            winMinimum: 30_000,
            winMaximum: 20_000,
          },
        },
      }).success,
    ).toBe(false);
  });
});

describe('Litestream configuration', () => {
  const template = ['snapshot:', '  interval: 1h', '  retention: 720h', '', 'retention:'].join(
    '\n',
  );

  it('renders the validated administrative retention value', () => {
    expect(renderLitestreamConfig(template, 45)).toContain('  retention: 1080h');
  });

  it('rejects an unsafe value or an ambiguous template', () => {
    expect(() => renderLitestreamConfig(template, 0)).toThrow();
    expect(() => renderLitestreamConfig('snapshot:\n  interval: 1h', 30)).toThrow();
  });

  it('supports older settings while rejecting an unsafe persisted retention', () => {
    expect(parseBackupRetentionDays({ missingRaceWarningTime: '17:00:00' })).toBe(30);
    expect(() => parseBackupRetentionDays({ backupRetentionDays: 91 })).toThrow();
  });
});
