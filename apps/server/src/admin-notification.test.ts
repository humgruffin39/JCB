import { describe, expect, it } from 'vitest';
import { buildAdminNoticeMessage } from './admin-notification.js';

describe('Discord admin notifications', () => {
  it('renders a clean Japanese embed without mention parsing', () => {
    const message = buildAdminNoticeMessage({
      level: 'warning',
      title: 'レースを中止しました',
      description: '参加者への投票額は全額返金しました。',
      fields: [
        { name: 'レースID', value: 'race-001', inline: true },
        { name: '中止理由', value: '@everyone *メンテナンス*' },
      ],
    });
    const embed = message.embeds[0];
    const json = embed?.toJSON();

    expect(message.content).toBeUndefined();
    expect(message.allowedMentions).toEqual({ parse: [] });
    expect(json.title).toBe('レースを中止しました');
    expect(json.description).toBe('参加者への投票額は全額返金しました。');
    expect(json.fields).toEqual([
      { name: 'レースID', value: 'race-001', inline: true },
      { name: '中止理由', value: '＠everyone \\*メンテナンス\\*', inline: false },
    ]);
    expect(json.footer).toBeUndefined();
    expect(json.timestamp).toBeUndefined();
  });

  it('uses distinct colors for each notification level', () => {
    const colors = (['info', 'success', 'warning', 'error'] as const).map(
      (level) => buildAdminNoticeMessage({ level, title: '通知' }).embeds[0]?.toJSON().color,
    );

    expect(new Set(colors).size).toBe(4);
  });
});
