import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PlaybackControls } from './race-viewer-controls.js';

describe('PlaybackControls in a Discord Activity', () => {
  it('keeps playback and camera controls but omits browser fullscreen', () => {
    const markup = renderToStaticMarkup(
      <PlaybackControls
        isPaused={false}
        canPause
        cameraMode="follow"
        isMobile
        isFullscreen
        showFullscreen={false}
        onPause={vi.fn()}
        onToggleCamera={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="1位を追尾"');
    expect(markup).toContain('aria-label="一時停止"');
    expect(markup).not.toContain('全画面');
  });
});
