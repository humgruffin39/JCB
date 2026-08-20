import { horseNumberEmoji, horseSelectionEmojis } from './horse-number-emoji.js';

describe('horse number emojis', () => {
  it('renders every supported horse selection without numeric placeholders', () => {
    const rendered = horseSelectionEmojis('1-4-8');
    expect(rendered).toBe(
      [horseNumberEmoji(1), horseNumberEmoji(4), horseNumberEmoji(8)].join(' '),
    );
    expect(rendered).not.toMatch(/`|\b0?[1-8]\b/u);
  });

  it('rejects invalid horse numbers', () => {
    expect(() => horseSelectionEmojis('1-9')).toThrow('Unsupported horse number');
  });
});
