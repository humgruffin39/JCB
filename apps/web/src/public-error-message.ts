import { ApiRequestError } from './api.js';

const API_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  AUTH_REQUIRED: '観戦リンクが必要です。',
  GUILD_MEMBERSHIP_REQUIRED: 'このDiscordサーバーのメンバーだけが観戦できます。',
  LOGIN_TICKET_INVALID: 'この観戦リンクは期限切れか、すでに使用されています。',
  RACE_NOT_FOUND: 'レース情報が見つかりません。',
  RACE_NOT_STARTED: '発走時刻前です。',
};

const KNOWN_PUBLIC_MESSAGES: Readonly<Record<string, string>> = {
  発走時刻前です: '発走時刻前です。',
  レース映像の解放情報を取得できません:
    'レース映像を準備できません。時間をおいてもう一度お試しください。',
  レース情報の版が一致しません: 'レース情報が更新されました。もう一度お試しください。',
  暗号化されたレース映像を取得できません:
    'レース映像を取得できません。時間をおいてもう一度お試しください。',
};

export function publicErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError && error.code !== undefined) {
    return API_ERROR_MESSAGES[error.code] ?? fallback;
  }
  if (error instanceof Error) {
    return KNOWN_PUBLIC_MESSAGES[error.message] ?? fallback;
  }
  return fallback;
}

export function initializationErrorMessage(error: unknown): string {
  const message = publicErrorMessage(error, '');
  const guidance = 'Discordの#競馬から新しいリンクを発行して開き直してください。';
  return message.length === 0 ? guidance : `${message}${guidance}`;
}
