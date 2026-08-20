import type Database from 'better-sqlite3';
import { SqliteViewerStore } from './viewer-store.js';

describe('viewer odds queries', () => {
  it('requires a selection for high-cardinality pools', () => {
    const store = new SqliteViewerStore({} as Database.Database);

    for (const poolType of ['exacta', 'trio', 'trifecta'] as const) {
      expect(() => store.getOdds('race-1', poolType)).toThrow(/selection is required/i);
    }
  });
});
