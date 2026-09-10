import { describe, expect, it } from 'vitest';
import { VENUE_THEME_IDS, venueTheme, type VenueThemeId } from './race-venue-theme.js';

describe('venue themes', () => {
  it('keeps every theme complete enough to build a scene from', () => {
    for (const id of VENUE_THEME_IDS) {
      const theme = venueTheme(id as VenueThemeId);
      expect(theme.id).toBe(id);
      expect(theme.label.length).toBeGreaterThan(0);
      expect(theme.fog.near).toBeLessThan(theme.fog.far);
      expect(theme.sun.intensity).toBeGreaterThan(0);
      expect(theme.hemisphere.intensity).toBeGreaterThan(0);
      expect(theme.sun.offset).toHaveLength(3);
      for (const colour of [
        theme.background,
        theme.fog.color,
        theme.sky.top,
        theme.sky.horizon,
        theme.sky.bottom,
        theme.turf.ground,
        theme.turf.track,
        theme.dirt.ground,
        theme.dirt.track,
        theme.rail,
      ]) {
        expect(colour).toBeGreaterThanOrEqual(0);
        expect(colour).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it('only lights the venue that has masts', () => {
    expect(venueTheme('standard').floodlights).toBeUndefined();
    expect(venueTheme('night').floodlights?.intensity).toBeGreaterThan(0);
  });
});
