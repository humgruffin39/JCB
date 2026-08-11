import { describe, expect, it } from 'vitest';
import { buildAdminNoticeMessage } from './admin-notification.js';

describe('Discord admin notifications', () => {
  it('renders a clean Japanese embed without mention parsing', () => {
    const message = buildAdminNoticeMessage(
      {
        level: 'warning',
        title: 'レースを中止しました',
        description: '参加者への投票額は全額返金しました。',
        fields: [
          { name: 'レースID', value: 'race-001', inline: true },
          { name: '中止理由', value: '@everyone *メンテナンス*' },
        ],
      },
      Date.UTC(2026, 7, 11, 8, 0, 0),
    );
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
    expect(json.footer?.text).toBe('ジョサン中央銀行 管理通知');
    expect(json.timestamp).toBe('2026-08-11T08:00:00.000Z');
  });

  it('uses distinct colors for each notification level', () => {
    const colors = (['info', 'success', 'warning', 'error'] as const).map(
      (level) => buildAdminNoticeMessage({ level, title: '通知' }, 0).embeds[0]?.toJSON().color,
    );

    expect(new Set(colors).size).toBe(4);
  });
});
