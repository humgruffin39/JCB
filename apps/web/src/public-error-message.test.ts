import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api.js';
import { initializationErrorMessage, publicErrorMessage } from './public-error-message.js';

describe('publicErrorMessage', () => {
  it('maps API errors to concise Japanese copy', () => {
    expect(
      publicErrorMessage(
        new ApiRequestError('Authentication required.', 401, 'AUTH_REQUIRED'),
        '映像を読み込めません。',
      ),
    ).toBe('観戦リンクが必要です。');
  });

  it('does not expose unknown backend text', () => {
    expect(publicErrorMessage(new Error('Failed to fetch'), '映像を読み込めません。')).toBe(
      '映像を読み込めません。',
    );
  });

  it('keeps initialization guidance actionable', () => {
    expect(
      initializationErrorMessage(
        new ApiRequestError('This link expired.', 410, 'LOGIN_TICKET_INVALID'),
      ),
    ).toBe(
      'この観戦リンクは期限切れか、すでに使用されています。Discordの#競馬から新しいリンクを発行して開き直してください。',
    );
  });
});
