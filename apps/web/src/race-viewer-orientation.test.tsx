import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RaceOrientationGate } from './race-viewer-orientation.js';

describe('RaceOrientationGate', () => {
  it('gives concise landscape guidance without an extra action', () => {
    const markup = renderToStaticMarkup(<RaceOrientationGate isVisible />);

    expect(markup).toContain('端末を横向きにしてください');
    expect(markup).toContain('画面の向きが固定されている場合は、回転ロックをオフにしてください。');
    expect(markup).not.toContain('全画面で観戦');
    expect(markup).not.toContain('<button');
    expect(markup).toContain('role="status"');
  });

  it('does not render anything when the viewport is usable', () => {
    expect(renderToStaticMarkup(<RaceOrientationGate isVisible={false} />)).toBe('');
  });
});
