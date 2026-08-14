import { describe, expect, it } from 'vitest';
import { parseCountCandidate } from '../counting/parser.js';

describe('parseCountCandidate', () => {
  it('accepts canonical integers and trims surrounding whitespace', () => {
    expect(parseCountCandidate(' 42\n')).toBe(42n);
    expect(parseCountCandidate('0')).toBe(0n);
  });

  it('accepts full-width digits and mixtures of full-width and ASCII digits', () => {
    expect(parseCountCandidate('４２')).toBe(42n);
    expect(parseCountCandidate('4２')).toBe(42n);
    expect(parseCountCandidate('０')).toBe(0n);
  });

  it.each(['01', '０１', '1.0', 'one', '１!', '1 2', '1+1'])('rejects %j', (input) => {
    expect(parseCountCandidate(input)).toBeNull();
  });

  it("handles values larger than JavaScript's safe integer range", () => {
    expect(parseCountCandidate('9007199254740993123456789')).toBe(
      9_007_199_254_740_993_123_456_789n,
    );
  });
});
