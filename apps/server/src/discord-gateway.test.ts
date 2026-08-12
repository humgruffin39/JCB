import { DomainError } from '@jcb/domain';
import { describe, expect, it } from 'vitest';
import {
  createViewerLinkReply,
  discordErrorMessage,
  isMissingDiscordMessage,
} from './discord-gateway.js';

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

  it('returns a viewer link button without exposing the URL in the message body', () => {
    const url = 'https://example.com/auth/ticket#ticket=one-time';
    const reply = createViewerLinkReply(url);

    expect(reply.content).toBe('このURLは一度だけ使え、5分で失効します。');
    expect(reply.content).not.toContain(url);
    expect(reply.components[0]?.components[0]?.data).toMatchObject({
      label: '観戦画面を開く',
      style: 5,
      url,
    });
  });
});
