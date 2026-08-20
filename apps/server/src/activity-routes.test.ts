import { serializeActivitySessionCookie } from './activity-routes.js';

describe('Discord Activity session cookie', () => {
  it('uses a host-local Lax cookie only when Discord is absent during development', () => {
    const cookie = serializeActivitySessionCookie(
      { NODE_ENV: 'development', DISCORD_CLIENT_ID: undefined },
      'opaque token',
      1_000,
    );
    expect(cookie).toContain('jcb_activity_session=opaque%20token');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Domain=');
    expect(cookie).not.toContain('Partitioned');
  });

  it('uses the secure Discord proxy cookie during proxied local development', () => {
    const cookie = serializeActivitySessionCookie(
      { NODE_ENV: 'development', DISCORD_CLIENT_ID: '123456789' },
      'opaque-token',
      1_000,
    );
    expect(cookie).toContain('Domain=123456789.discordsays.com');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Partitioned');
  });

  it('is securely partitioned to the Discord Activity proxy in production', () => {
    const cookie = serializeActivitySessionCookie(
      { NODE_ENV: 'production', DISCORD_CLIENT_ID: '123456789' },
      'opaque-token',
      1_000,
    );
    expect(cookie).toContain('Domain=123456789.discordsays.com');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Partitioned');
  });

  it('uses a distinct cookie name for each Activity instance', () => {
    const first = serializeActivitySessionCookie(
      { NODE_ENV: 'production', DISCORD_CLIENT_ID: '123456789' },
      'opaque-token',
      1_000,
      'instance-1',
    );
    const second = serializeActivitySessionCookie(
      { NODE_ENV: 'production', DISCORD_CLIENT_ID: '123456789' },
      'opaque-token',
      1_000,
      'instance-2',
    );
    expect(first.split('=', 1)[0]).not.toBe(second.split('=', 1)[0]);
  });
});
