import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGrandstand } from './race-environment-grandstand.js';
import { createTrackside } from './race-environment-trackside.js';
import { TRACK_HALF_WIDTH } from './race-course.js';
import { VENUE_THEME_IDS, venueTheme } from './race-venue-theme.js';

const DISTANCES = [1_200, 1_600, 2_000, 2_400] as const;

function bounds(object: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(object);
}

describe('venue construction', () => {
  it('builds a stand and its trackside for every theme and distance', () => {
    for (const id of VENUE_THEME_IDS) {
      const theme = venueTheme(id);
      for (const distanceM of DISTANCES) {
        const stand = createGrandstand(distanceM, theme, 0.2);
        const trackside = createTrackside(distanceM, theme);

        expect(stand.group.children.length).toBeGreaterThan(0);
        expect(trackside.children.length).toBeGreaterThan(0);
        // Nothing may be left at the origin with no size, which is what a
        // mis-anchored piece of furniture looks like.
        expect(bounds(stand.group).isEmpty()).toBe(false);
        expect(bounds(trackside).isEmpty()).toBe(false);
      }
    }
  });

  it('grows the stand with the home straight instead of leaving a gap', () => {
    const theme = venueTheme('standard');
    const short = bounds(createGrandstand(1_200, theme, 0.2).group);
    const long = bounds(createGrandstand(2_400, theme, 0.2).group);

    expect(long.max.x - long.min.x).toBeGreaterThan((short.max.x - short.min.x) * 1.8);
  });

  it('keeps the crowd bill roughly flat as the stand gets longer', () => {
    const theme = venueTheme('standard');
    const count = (distanceM: number): number => {
      const stand = createGrandstand(distanceM, theme, 1);
      let total = 0;
      stand.group.traverse((child) => {
        if (child instanceof THREE.InstancedMesh) total = Math.max(total, child.count);
      });
      return total;
    };

    // Twice the straight must not mean twice the frame cost.
    expect(count(2_400)).toBeLessThan(count(1_200) * 1.35);
  });

  it('leaves the racing surface clear of trackside furniture', () => {
    const trackside = createTrackside(2_000, venueTheme('standard'));
    for (const child of trackside.children) {
      const box = bounds(child);
      if (box.isEmpty()) continue;
      // Everything sits outside the running rails or beyond them; nothing may
      // straddle the middle of the course itself.
      expect(Math.abs(box.min.z) + Math.abs(box.max.z)).toBeGreaterThan(TRACK_HALF_WIDTH);
    }
  });
});
