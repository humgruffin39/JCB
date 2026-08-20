import type Database from 'better-sqlite3';
import { SqliteViewerStore, parseFinalWinOdds } from './viewer-store.js';

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
