import { describe, expect, it } from 'vitest';
import {
  formatHorseInfoLine,
  horseStrength,
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
  it('renders all eight entries in one compact embed without raw abilities', () => {
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
    const description = embed.description ?? '';
    expect(description.split('\n')).toHaveLength(10);
    expect(description).toContain(
      '`01` 情報馬1｜脚質 逃げ｜距離適性 △｜馬場適性 芝△｜持ち味 スピード',
    );
    expect(description).not.toContain('90');
    expect(description).not.toContain('tieBreaker');
    expect(description).not.toContain('勝率');
    expect(description.length).toBeLessThan(4096);
  });

  it('uses three marks for the signed preference score', () => {
    expect(distancePreferenceMark(0.15)).toBe('◎');
    expect(distancePreferenceMark(-0.15)).toBe('△');
    expect(distancePreferenceMark(0.14)).toBe('○');
    expect(surfacePreferenceMark(1 / 3)).toBe('◎');
    expect(surfacePreferenceMark(-1 / 3)).toBe('△');
    expect(preferenceMark(0)).toBe('○');
  });

  it('maps running styles and exposes at most one natural strength label', () => {
    expect(runningStyleLabel('front_runner')).toBe('逃げ');
    expect(runningStyleLabel('closer')).toBe('差し');
    expect(horseStrength(entry)).toBe('スピード');
    const line = formatHorseInfoLine(entry, 1800, 'dirt');
    expect(line.match(/持ち味/g)).toHaveLength(1);
    expect(line).toContain('馬場適性 ダ◎');
  });
});
