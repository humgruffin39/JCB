import { gameSettingsSchema, type GameSettings } from '@jcb/config';

export function readSettings(form: FormData, current: GameSettings | undefined): GameSettings {
  if (current === undefined) throw new Error('現在の設定を取得できません。');
  return gameSettingsSchema.parse({
    missingRaceWarningTime: requiredString(form, 'missingRaceWarningTime'),
    recommendedLockTime: requiredString(form, 'recommendedLockTime'),
    viewerOpenTime: requiredString(form, 'viewerOpenTime'),
    bettingCloseTime: requiredString(form, 'bettingCloseTime'),
    startTime: requiredString(form, 'startTime'),
    conditionProbabilities: {
      terrible: requiredNumber(form, 'condition.terrible') / 100,
      poor: requiredNumber(form, 'condition.poor') / 100,
      normal: requiredNumber(form, 'condition.normal') / 100,
      good: requiredNumber(form, 'condition.good') / 100,
      excellent: requiredNumber(form, 'condition.excellent') / 100,
    },
    simulationNoiseStandardDeviation: requiredNumber(form, 'simulationNoiseStandardDeviation'),
    fatigueMaximum: requiredNumber(form, 'fatigueMaximum'),
    seedLiquidityClamp: {
      regular: {
        winMinimum: requiredNumber(form, 'seed.regular.winMinimum'),
        winMaximum: requiredNumber(form, 'seed.regular.winMaximum'),
        trifectaMinimum: requiredNumber(form, 'seed.regular.trifectaMinimum'),
        trifectaMaximum: requiredNumber(form, 'seed.regular.trifectaMaximum'),
      },
      special: {
        winMinimum: requiredNumber(form, 'seed.special.winMinimum'),
        winMaximum: requiredNumber(form, 'seed.special.winMaximum'),
        trifectaMinimum: requiredNumber(form, 'seed.special.trifectaMinimum'),
        trifectaMaximum: requiredNumber(form, 'seed.special.trifectaMaximum'),
      },
    },
    raceBetLimits: {
      regular: requiredNumber(form, 'raceBetLimits.regular'),
      midweek: requiredNumber(form, 'raceBetLimits.midweek'),
      saturday_night: requiredNumber(form, 'raceBetLimits.saturday_night'),
    },
    discordOddsUpdateMilliseconds: requiredNumber(form, 'discordOddsUpdateMilliseconds') * 1_000,
    webOddsPollMilliseconds: requiredNumber(form, 'webOddsPollMilliseconds') * 1_000,
    backupRetentionDays: requiredNumber(form, 'backupRetentionDays'),
    visualEffectStrength: requiredNumber(form, 'visualEffectStrength'),
    soundVolume: requiredNumber(form, 'soundVolume'),
  });
}

export function requiredString(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} を入力してください。`);
  }
  return value.trim();
}

function requiredNumber(form: FormData, key: string): number {
  const value = Number(requiredString(form, key));
  if (!Number.isFinite(value)) throw new Error(`${key} は数値で入力してください。`);
  return value;
}
