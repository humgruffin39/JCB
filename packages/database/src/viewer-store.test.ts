import type Database from 'better-sqlite3';
import { SqliteViewerStore, parseFinalOdds, parseFinalWinOdds } from './viewer-store.js';

describe('viewer odds queries', () => {
  it('requires a selection for high-cardinality pools', () => {
    const store = new SqliteViewerStore({} as Database.Database);

    for (const poolType of ['exacta', 'trio', 'trifecta'] as const) {
      expect(() => store.getOdds('race-1', poolType)).toThrow(/selection is required/i);
    }
  });

  it('uses valid final win odds and ignores malformed entries', () => {
    expect(
      Object.fromEntries(
        parseFinalWinOdds(
          JSON.stringify({
            'win:1': '2.4',
            'win:2': '11.0',
            'win:3': 7.2,
            'place:1': '1.1',
          }),
        ),
      ),
    ).toEqual({ 1: '2.4', 2: '11.0' });
    expect(parseFinalWinOdds('{')).toEqual(new Map());
    expect(parseFinalWinOdds(null)).toEqual(new Map());
  });
});

describe('parseFinalOdds', () => {
  it('keeps every pool type from the snapshot, not just win', () => {
    const odds = parseFinalOdds(
      JSON.stringify({ 'win:1': '2.4', 'place:1': '1.3', 'wide:1-2': '5.0' }),
    );
    expect(odds.get('win:1')).toBe('2.4');
    expect(odds.get('place:1')).toBe('1.3');
    expect(odds.get('wide:1-2')).toBe('5.0');
  });

  it('drops entries that are not odds and survives broken JSON', () => {
    expect(parseFinalOdds(JSON.stringify({ 'win:1': 'abc', 'win:2': 3 })).size).toBe(0);
    expect(parseFinalOdds('{')).toEqual(new Map());
    expect(parseFinalOdds(null)).toEqual(new Map());
  });
});
