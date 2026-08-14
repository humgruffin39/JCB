import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RaceOrientationGate } from './race-viewer-orientation.js';

describe('RaceOrientationGate', () => {
  it('gives concise landscape guidance with a fullscreen action', () => {
    const markup = renderToStaticMarkup(
      <RaceOrientationGate isVisible onEnterImmersiveMode={vi.fn().mockResolvedValue(undefined)} />,
    );

    expect(markup).toContain('端末を横向きにしてください');
    expect(markup).toContain('画面の向きが固定されている場合は、回転ロックをオフにしてください。');
    expect(markup).toContain('全画面で観戦');
    expect(markup).toContain('role="status"');
  });

  it('does not render anything when the viewport is usable', () => {
    expect(
      renderToStaticMarkup(
        <RaceOrientationGate
          isVisible={false}
          onEnterImmersiveMode={vi.fn().mockResolvedValue(undefined)}
        />,
      ),
    ).toBe('');
  });
});
