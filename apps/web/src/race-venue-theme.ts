export type VenueThemeId = 'standard' | 'night';

export interface VenueSurfacePalette {
  readonly ground: number;
  readonly track: number;
}

/**
 * Everything that makes one venue feel unlike another.
 *
 * The course geometry, the horses and the simulation are untouched by any of
 * this: a theme is colour, light and a few props. That is deliberate — a replay
 * of an old race must still be the same race, whatever it now looks like.
 */
export interface VenueTheme {
  readonly id: VenueThemeId;
  readonly label: string;
  readonly background: number;
  readonly fog: { readonly color: number; readonly near: number; readonly far: number };
  readonly sky: { readonly top: number; readonly horizon: number; readonly bottom: number };
  readonly hemisphere: {
    readonly sky: number;
    readonly ground: number;
    readonly intensity: number;
  };
  readonly sun: {
    readonly color: number;
    readonly intensity: number;
    /** Offset of the key light from whatever the camera is following. */
    readonly offset: readonly [number, number, number];
  };
  readonly turf: VenueSurfacePalette;
  readonly dirt: VenueSurfacePalette;
  readonly rail: number;
  readonly horizonBuilding: number;
  readonly cloud: { readonly color: number; readonly opacity: number };
  readonly grandstand: {
    readonly structure: number;
    readonly roof: number;
    readonly seats: number;
    readonly glass: number;
    readonly glassGlow: number;
    /** Skin tones, picked per spectator from a seeded shuffle. */
    readonly crowd: readonly number[];
    /** What they are wearing, which is what carries the colour of a crowd. */
    readonly clothes: readonly number[];
    readonly flags: readonly number[];
    readonly litFacade: boolean;
  };
  readonly hoardings: readonly number[];
  readonly marker: { readonly post: number; readonly cap: number };
  readonly screen: { readonly frame: number; readonly face: number; readonly glow: number };
  /** The flower bed inside the home turn. */
  readonly planting: number;
  readonly perimeter: { readonly fence: number; readonly hedge: number; readonly road: number };
  readonly floodlights?: {
    readonly mast: number;
    readonly lamp: number;
    readonly intensity: number;
    readonly range: number;
  };
}

const STANDARD: VenueTheme = {
  id: 'standard',
  label: '昼',
  background: 0x94b8c9,
  fog: { color: 0xa7bfbe, near: 140, far: 620 },
  sky: { top: 0x609abe, horizon: 0xdbe5df, bottom: 0x8ba67d },
  hemisphere: { sky: 0xd7ecf1, ground: 0x4c522e, intensity: 2.25 },
  sun: { color: 0xfff2d2, intensity: 3.5, offset: [-18, 36, 24] },
  turf: { ground: 0x4f6d31, track: 0x769a4d },
  dirt: { ground: 0x59452e, track: 0x9a7045 },
  rail: 0xe8e7df,
  horizonBuilding: 0x6f7f6a,
  cloud: { color: 0xffffff, opacity: 0.62 },
  grandstand: {
    structure: 0xd9d8ce,
    roof: 0xb9bcc2,
    seats: 0x2f3a46,
    glass: 0x9fb4c4,
    glassGlow: 0xdfe9f2,
    crowd: [0xe4d7c5, 0xd7b49a, 0xc98f74, 0x8f6a52, 0xf0e6da, 0xb08668],
    clothes: [
      0xe8e4dc, 0x3b4a6b, 0x8f2f3a, 0x2f5d45, 0xd8a13a, 0x5c4a7a, 0x1f2933, 0xc8683f, 0xb9c4cf,
      0x6d7a4a,
    ],
    flags: [0xd94f4f, 0x3f74c4, 0xe7c34a, 0xf2f0e8, 0x4aa06a],
    litFacade: false,
  },
  hoardings: [0xd94f4f, 0x2f4f8f, 0xe7c34a, 0xf2f0e8, 0x2f7d55, 0x8f4fa0],
  marker: { post: 0xf0efe7, cap: 0xd94f4f },
  screen: { frame: 0x6f7681, face: 0x101820, glow: 0x2f6f8f },
  planting: 0x5b7f3a,
  perimeter: { fence: 0xcfd2cb, hedge: 0x2f4f2b, road: 0x9d9a93 },
};

const NIGHT: VenueTheme = {
  id: 'night',
  label: 'ナイター',
  background: 0x070c18,
  fog: { color: 0x0b1322, near: 70, far: 430 },
  sky: { top: 0x03060f, horizon: 0x1b2740, bottom: 0x080d18 },
  hemisphere: { sky: 0x39496a, ground: 0x1f2a1c, intensity: 1.75 },
  // A low moon from the far side keeps the horses rim-lit instead of flat.
  sun: { color: 0xb9cdff, intensity: 1.7, offset: [22, 44, -30] },
  turf: { ground: 0x27351f, track: 0x466036 },
  dirt: { ground: 0x35291c, track: 0x654a2f },
  rail: 0xb9bfc9,
  horizonBuilding: 0x1a2130,
  cloud: { color: 0x223047, opacity: 0.12 },
  grandstand: {
    structure: 0x6a7180,
    roof: 0x474e5c,
    seats: 0x1b2430,
    glass: 0x3d4c5e,
    glassGlow: 0xffd9a0,
    crowd: [0xb9a894, 0xa88770, 0x8d6a55, 0x6d5140, 0xc9bcab, 0x7f6754],
    clothes: [
      0xb6b2ab, 0x2c3852, 0x6e2630, 0x24483a, 0xa87b2e, 0x463a5e, 0x181f28, 0x9a5231, 0x8d97a2,
      0x545e3b,
    ],
    flags: [0xa63b3b, 0x2f5896, 0xb99436, 0xc6c3ba, 0x3a7a52],
    litFacade: true,
  },
  hoardings: [0xa63b3b, 0x243c6e, 0xb99436, 0xc6c3ba, 0x24603f, 0x6c3b7a],
  marker: { post: 0xc8c7c0, cap: 0xd94f4f },
  screen: { frame: 0x4a515c, face: 0x0a1018, glow: 0x4fa8d8 },
  planting: 0x2c3f20,
  perimeter: { fence: 0x878b85, hedge: 0x182a16, road: 0x4e4c47 },
  // Point-light intensity is candela and the lamps sit 34m up, so this reads far
  // larger than a lamp in a room: at the rail it lands around one unit.
  floodlights: { mast: 0x8f97a4, lamp: 0xfff4d0, intensity: 13_000, range: 420 },
};

export const VENUE_THEMES: Readonly<Record<VenueThemeId, VenueTheme>> = {
  standard: STANDARD,
  night: NIGHT,
};

export const VENUE_THEME_IDS = ['standard', 'night'] as const;

export function venueTheme(id: VenueThemeId): VenueTheme {
  return VENUE_THEMES[id];
}
