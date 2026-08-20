import { describe, expect, it } from 'vitest';
import {
  preferenceMark,
  distancePreferenceMark,
  renderHorseInfoMessage,
  runningStyleLabel,
  surfacePreferenceMark,
  type DiscordHorseInfoEntry,
} from './horse-info.js';

const entry: DiscordHorseInfoEntry = {
  horseNumber: 1,
  name: '情報馬',
  runningStyle: 'front_runner',
  speed: 90,
  start: 70,
  acceleration: 80,
  stamina: 50,
  lateKick: 60,
  conditionStability: 40,
  distancePreference: 60,
  surfacePreference: 80,
};

describe('Discord horse information', () => {
  it('renders each entry as a compact non-inline field without redundant labels', () => {
    const message = renderHorseInfoMessage({
      distanceM: 1200,
      surface: 'turf',
      entries: Array.from({ length: 8 }, (_, index) => ({
        ...entry,
        horseNumber: index + 1,
        name: `情報馬${String(index + 1)}`,
      })),
    });
    const embed = message.embeds[0].toJSON();
    expect(embed.title).toBe('出走馬情報');
    expect(embed.description).toBeUndefined();
    expect(embed.fields).toHaveLength(8);
    expect(embed.fields?.[0]).toEqual({
      name: '<:horse_1:1539913567787159653> 情報馬1',
      value: '逃げ馬 適正: 距離 △ 馬場 △',
      inline: false,
    });
    expect(embed.fields?.[7]).toEqual({
      name: '<:horse_8:1539913577345851412> 情報馬8',
      value: '逃げ馬 適正: 距離 △ 馬場 △',
      inline: false,
    });
  });

  it('uses three marks for the signed preference score', () => {
    expect(distancePreferenceMark(0.15)).toBe('◎');
    expect(distancePreferenceMark(-0.15)).toBe('△');
    expect(distancePreferenceMark(0.14)).toBe('○');
    expect(surfacePreferenceMark(1 / 3)).toBe('◎');
    expect(surfacePreferenceMark(-1 / 3)).toBe('△');
    expect(preferenceMark(0)).toBe('○');
  });

  it('maps running styles and keeps preference labels concise', () => {
    expect(runningStyleLabel('front_runner')).toBe('逃げ馬');
    expect(runningStyleLabel('closer')).toBe('差し馬');
    const message = renderHorseInfoMessage({
      distanceM: 1800,
      surface: 'dirt',
      entries: Array.from({ length: 8 }, (_, index) => ({
        ...entry,
        horseNumber: index + 1,
        runningStyle: 'closer' as const,
      })),
    });
    expect(message.embeds[0].toJSON().fields?.[0]).toMatchObject({
      value: '差し馬 適正: 距離 ○ 馬場 ◎',
    });
  });
});
