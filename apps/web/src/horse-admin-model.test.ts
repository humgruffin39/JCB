import { describe, expect, it } from 'vitest';
import { horseCoatLabel } from './horse-admin-model.js';

describe('horse admin model', () => {
  it('uses the labels shown by both the list and editor', () => {
    expect(horseCoatLabel('black')).toBe('黒');
    expect(horseCoatLabel('chestnut')).toBe('栗毛');
    expect(horseCoatLabel('gray')).toBe('グレー');
    expect(horseCoatLabel('cream')).toBe('クリーム');
  });
});
