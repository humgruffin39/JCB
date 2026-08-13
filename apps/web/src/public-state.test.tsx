import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PublicState, type PublicStateStatus } from './public-state.js';

const statusCases = [
  ['loading', 'status', true],
  ['waiting', 'status', false],
  ['error', 'alert', false],
  ['unavailable', 'alert', false],
] as const satisfies ReadonlyArray<readonly [PublicStateStatus, 'status' | 'alert', boolean]>;

describe('PublicState', () => {
  it.each(statusCases)(
    'renders %s with the correct live-region semantics',
    (status, role, isBusy) => {
      const markup = renderToStaticMarkup(
        <PublicState status={status} heading="状態の見出し" message="状態の説明" />,
      );

      expect(markup).toContain('class="public-state"');
      expect(markup).toContain(`data-state="${status}"`);
      expect(markup).toContain(`role="${role}"`);
      expect(markup).toContain('class="public-state__heading"');
      expect(markup).toContain('class="public-state__message"');
      expect(markup).not.toContain('aria-live');

      if (isBusy) {
        expect(markup).toContain('aria-busy="true"');
      } else {
        expect(markup).not.toContain('aria-busy');
      }
    },
  );

  it('omits optional message and action markup when no content or operation is provided', () => {
    const markup = renderToStaticMarkup(<PublicState status="waiting" heading="待機中" />);

    expect(markup).not.toContain('public-state__message');
    expect(markup).not.toContain('public-state__action');
  });

  it('does not render an action button', () => {
    const markup = renderToStaticMarkup(
      <PublicState status="error" heading="読み込めません" message="説明" />,
    );

    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('public-state__action');
  });

  it('keeps the base class when an integration-specific class is supplied', () => {
    const markup = renderToStaticMarkup(
      <PublicState
        status="waiting"
        heading="場面を準備しています"
        className="public-state--scene"
      />,
    );

    expect(markup).toContain('class="public-state public-state--scene"');
  });
});
