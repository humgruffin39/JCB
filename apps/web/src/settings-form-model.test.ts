import { DEFAULT_GAME_SETTINGS } from '@jcb/config';
import { describe, expect, it } from 'vitest';
import { readSettings } from './settings-form-model.js';

describe('settings form model', () => {
  it('converts percentages and seconds back to stored units', () => {
    const form = formForDefaultSettings();
    form.set('condition.normal', '60');
    form.set('condition.good', '20');
    form.set('condition.terrible', '5');
    form.set('condition.poor', '10');
    form.set('condition.excellent', '5');
    form.set('webOddsPollMilliseconds', '12');

    const settings = readSettings(form, DEFAULT_GAME_SETTINGS);

    expect(settings.conditionProbabilities.normal).toBe(0.6);
    expect(settings.webOddsPollMilliseconds).toBe(12_000);
  });

  it('reports a localized error when current settings are unavailable', () => {
    expect(() => readSettings(new FormData(), undefined)).toThrow('現在の設定を取得できません。');
  });
});

function formForDefaultSettings(): FormData {
  const settings = DEFAULT_GAME_SETTINGS;
  const form = new FormData();
  const values: Readonly<Record<string, string | number>> = {
    missingRaceWarningTime: settings.missingRaceWarningTime,
    recommendedLockTime: settings.recommendedLockTime,
    viewerOpenTime: settings.viewerOpenTime,
    bettingCloseTime: settings.bettingCloseTime,
    startTime: settings.startTime,
    'condition.terrible': settings.conditionProbabilities.terrible * 100,
    'condition.poor': settings.conditionProbabilities.poor * 100,
    'condition.normal': settings.conditionProbabilities.normal * 100,
    'condition.good': settings.conditionProbabilities.good * 100,
    'condition.excellent': settings.conditionProbabilities.excellent * 100,
    simulationNoiseStandardDeviation: settings.simulationNoiseStandardDeviation,
    fatigueMaximum: settings.fatigueMaximum,
    'seed.regular.winMinimum': settings.seedLiquidityClamp.regular.winMinimum,
    'seed.regular.winMaximum': settings.seedLiquidityClamp.regular.winMaximum,
    'seed.regular.trifectaMinimum': settings.seedLiquidityClamp.regular.trifectaMinimum,
    'seed.regular.trifectaMaximum': settings.seedLiquidityClamp.regular.trifectaMaximum,
    'seed.special.winMinimum': settings.seedLiquidityClamp.special.winMinimum,
    'seed.special.winMaximum': settings.seedLiquidityClamp.special.winMaximum,
    'seed.special.trifectaMinimum': settings.seedLiquidityClamp.special.trifectaMinimum,
    'seed.special.trifectaMaximum': settings.seedLiquidityClamp.special.trifectaMaximum,
    'raceBetLimits.regular': settings.raceBetLimits.regular,
    'raceBetLimits.midweek': settings.raceBetLimits.midweek,
    'raceBetLimits.saturday_night': settings.raceBetLimits.saturday_night,
    discordOddsUpdateMilliseconds: settings.discordOddsUpdateMilliseconds / 1_000,
    webOddsPollMilliseconds: settings.webOddsPollMilliseconds / 1_000,
    backupRetentionDays: settings.backupRetentionDays,
    visualEffectStrength: settings.visualEffectStrength,
    soundVolume: settings.soundVolume,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, String(value));
  return form;
}
