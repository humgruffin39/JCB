import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminTabList, wrappedTabIndex } from './admin-tab-list.js';

describe('AdminTabList', () => {
  it('exposes one selected keyboard tab and its panel relationship', () => {
    const markup = renderToStaticMarkup(
      <AdminTabList
        label="管理メニュー"
        tabs={[
          { id: 'first', label: '最初' },
          { id: 'second', label: '次' },
        ]}
        selected="second"
        onSelect={vi.fn()}
        idPrefix="test-tab"
        panelId="test-panel"
      />,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('id="test-tab-first"');
    expect(markup).toContain('aria-selected="false" aria-controls="test-panel" tabindex="-1"');
    expect(markup).toContain('id="test-tab-second"');
    expect(markup).toContain('aria-selected="true" aria-controls="test-panel" tabindex="0"');
  });

  it('wraps arrow-key navigation at both ends', () => {
    expect(wrappedTabIndex(-1, 4)).toBe(3);
    expect(wrappedTabIndex(4, 4)).toBe(0);
    expect(wrappedTabIndex(0, 0)).toBe(0);
  });
});
