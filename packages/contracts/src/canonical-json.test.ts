import { canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('orders keys by code unit rather than by locale', () => {
    // `localeCompare` puts these the other way round in most locales, which is
    // how the signing and verifying runtimes could disagree.
    expect(canonicalJson({ a: 1, B: 2 })).toBe('{"B":2,"a":1}');
    expect(canonicalJson({ _x: 1, ax: 2 })).toBe('{"_x":1,"ax":2}');
  });

  it('is independent of the order the keys were written in', () => {
    expect(canonicalJson({ b: 1, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 1 }),
    );
  });

  it('keeps array order and encodes primitives as JSON does', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson({ n: null, s: 'x', t: true })).toBe('{"n":null,"s":"x","t":true}');
  });

  it('matches the ordering an independent code unit sort produces', () => {
    const manifest = {
      raceId: 'r',
      raceVersion: 1,
      iv: 'i',
      authTag: 'a',
      codecVersion: 'c',
      ciphertextSha256: 's',
      ciphertextObjectKey: 'k',
      simulationVersion: 'v',
      scheduledStart: 2,
      viewerOpensAt: 3,
      timelineDuration: 4,
    };
    const expected = `{${Object.keys(manifest)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${JSON.stringify(manifest[key as keyof typeof manifest])}`,
      )
      .join(',')}}`;
    expect(canonicalJson(manifest)).toBe(expected);
  });
});
