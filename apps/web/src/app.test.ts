import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api.js';
import { initializationErrorMessage, raceIdFromPathname } from './app.js';

describe('raceIdFromPathname', () => {
  it('does not restore a previous race from the generic ticket path', () => {
    expect(raceIdFromPathname('/ticket')).toBeUndefined();
  });

  it('reads a race id only from a race route', () => {
    expect(raceIdFromPathname('/races/race-1')).toBe('race-1');
  });

  it('keeps expired ticket errors Japanese and actionable', () => {
    expect(
      initializationErrorMessage(
        new ApiRequestError(
          'This Discord link has expired or was already used.',
          410,
          'LOGIN_TICKET_INVALID',
        ),
      ),
    ).toBe(
      'この観戦リンクは期限切れか、すでに使用されています。Discordの#競馬から新しいリンクを発行して開き直してください。',
    );
  });

  it('does not expose raw backend text for unknown initialization errors', () => {
    expect(initializationErrorMessage(new Error('Internal server error.'))).toBe(
      'Discordの#競馬から新しいリンクを発行して開き直してください。',
    );
  });
});
