import { DomainError } from '@jcb/domain';
import { describe, expect, it } from 'vitest';
import { discordErrorMessage, isMissingDiscordMessage } from './discord-gateway.js';

describe('Discord error messages', () => {
  it('maps purchase domain errors to concise Japanese guidance', () => {
    expect(
      discordErrorMessage(new DomainError('INSUFFICIENT_FUNDS', 'Insufficient balance.')),
    ).toBe('残高が不足しています。');
    expect(discordErrorMessage(new DomainError('BETTING_CLOSED', 'Betting is closed.'))).toBe(
      'このレースの投票受付は終了しました。',
    );
  });

  it('keeps unknown failures generic', () => {
    expect(discordErrorMessage(new Error('database internals'))).toBe(
      '処理できませんでした。時間をおいて再度お試しください。',
    );
  });

  it('recreates a fixed message only for a missing-message response', () => {
    expect(isMissingDiscordMessage({ code: 10_008 })).toBe(true);
    expect(isMissingDiscordMessage({ status: 404 })).toBe(true);
    expect(isMissingDiscordMessage({ status: 503 })).toBe(false);
    expect(isMissingDiscordMessage(new Error('network timeout'))).toBe(false);
  });
});
