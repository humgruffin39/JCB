import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BroadcastHud } from './race-viewer-hud.js';

const horses = [
  { horseNumber: 4, rank: 1, progress: 0.6 },
  { horseNumber: 2, rank: 2, progress: 0.58 },
];

describe('BroadcastHud Activity layouts', () => {
  it('keeps the complete interactive HUD in focused mode', () => {
    const markup = renderToStaticMarkup(
      <BroadcastHud
        raceName="テストレース"
        distanceM={2_000}
        surface="turf"
        orderedHorses={horses}
        position={42_000}
        trackedHorseNumber={undefined}
        onTrackHorse={vi.fn()}
      />,
    );

    expect(markup).toContain('現在の走行順');
    expect(markup).toContain('4番を追尾');
    expect(markup).toContain('course-progress');
  });

  it('removes camera targets and course detail from compact layouts', () => {
    const markup = renderToStaticMarkup(
      <BroadcastHud
        raceName="テストレース"
        distanceM={2_000}
        surface="turf"
        orderedHorses={horses}
        position={42_000}
        trackedHorseNumber={4}
        onTrackHorse={vi.fn()}
        compact
      />,
    );

    expect(markup).toContain('テストレース');
    expect(markup).toContain('42.0s');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('course-progress');
  });
});
