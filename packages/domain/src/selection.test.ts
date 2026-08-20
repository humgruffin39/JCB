import { DomainError } from './errors.js';
import { POOL_TYPES, allSelections, selectionCode, winningSelections } from './selection.js';

describe('race selection definitions', () => {
  it('generates the expected number of selections for every pool type', () => {
    const expectedCounts = [8, 8, 28, 56, 28, 56, 336];

    expect(POOL_TYPES.map((poolType) => allSelections(poolType).length)).toEqual(expectedCounts);
    for (const poolType of POOL_TYPES) {
      const selections = allSelections(poolType);
      expect(new Set(selections).size).toBe(selections.length);
    }
  });

  it('normalizes unordered selections and preserves ordered selections', () => {
    expect(selectionCode('win', [4])).toBe('4');
    expect(selectionCode('place', [4])).toBe('4');
    expect(selectionCode('quinella', [4, 1])).toBe('1-4');
    expect(selectionCode('exacta', [4, 1])).toBe('4-1');
    expect(selectionCode('wide', [4, 1])).toBe('1-4');
    expect(selectionCode('trio', [7, 4, 1])).toBe('1-4-7');
    expect(selectionCode('trifecta', [7, 4, 1])).toBe('7-4-1');
  });

  it('derives all winning selections from the top three finishers', () => {
    const finishOrder = [4, 1, 7, 2, 5, 8, 3, 6];

    expect(winningSelections('win', finishOrder)).toEqual(['4']);
    expect(winningSelections('place', finishOrder)).toEqual(['4', '1', '7']);
    expect(winningSelections('quinella', finishOrder)).toEqual(['1-4']);
    expect(winningSelections('exacta', finishOrder)).toEqual(['4-1']);
    expect(winningSelections('wide', finishOrder)).toEqual(['1-4', '4-7', '1-7']);
    expect(winningSelections('trio', finishOrder)).toEqual(['1-4-7']);
    expect(winningSelections('trifecta', finishOrder)).toEqual(['4-1-7']);
  });

  it('rejects incomplete, duplicated, and invalid selections', () => {
    expect(() => selectionCode('win', [])).toThrow(DomainError);
    expect(() => selectionCode('quinella', [1])).toThrow(DomainError);
    expect(() => selectionCode('trifecta', [1, 1, 2])).toThrow(DomainError);
    expect(() => selectionCode('win', [0])).toThrow(DomainError);
    expect(() => selectionCode('place', [9])).toThrow(DomainError);
    expect(() => winningSelections('win', [1, 2])).toThrow(DomainError);
    expect(() => winningSelections('wide', [1, 2, 2])).toThrow(DomainError);
  });
});
