import {
  conditionMultiplier,
  distancePreferenceScore,
  surfacePreferenceScore,
  type HorseAbilities,
} from './horse.js';

const abilities: HorseAbilities = {
  speed: 50,
  start: 50,
  acceleration: 50,
  stamina: 50,
  lateKick: 50,
  conditionStability: 50,
  distancePreference: 60,
  surfacePreference: -40,
};

describe('horse modifiers', () => {
  it('uses a centered distance axis with symmetric bonuses and penalties', () => {
    expect(distancePreferenceScore(abilities, 1200)).toBe(-0.6);
    expect(distancePreferenceScore(abilities, 1800)).toBe(0);
    expect(distancePreferenceScore(abilities, 2400)).toBe(0.6);
  });

  it('uses a centered surface axis with symmetric bonuses and penalties', () => {
    expect(surfacePreferenceScore(abilities, 'turf')).toBe(0.4);
    expect(surfacePreferenceScore(abilities, 'dirt')).toBe(-0.4);
    expect(surfacePreferenceScore({ ...abilities, surfacePreference: 0 }, 'turf')).toBe(0);
    expect(surfacePreferenceScore({ ...abilities, surfacePreference: 0 }, 'dirt')).toBe(0);
  });

  it('eliminates condition modifiers at stability 100', () => {
    expect(conditionMultiplier('terrible', 100)).toBe(1);
    expect(conditionMultiplier('excellent', 100)).toBe(1);
  });

  it('applies the full plus or minus eight percent at stability zero', () => {
    expect(conditionMultiplier('terrible', 0)).toBeCloseTo(0.92);
    expect(conditionMultiplier('excellent', 0)).toBeCloseTo(1.08);
  });
});
