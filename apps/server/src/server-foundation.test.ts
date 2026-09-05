import type { FastifyRequest } from 'fastify';
import { rateLimitKey } from './server-foundation.js';

const request = (
  cookies: Record<string, string>,
  headers: Record<string, string> = {},
  ip = '10.0.0.1',
): FastifyRequest => ({ cookies, headers, ip }) as unknown as FastifyRequest;

describe('rateLimitKey', () => {
  it('ignores a forged X-Forwarded-For', () => {
    const forged = request({}, { 'x-forwarded-for': '1.2.3.4', 'fly-client-ip': '9.9.9.9' });
    const alsoForged = request({}, { 'x-forwarded-for': '5.6.7.8', 'fly-client-ip': '9.9.9.9' });
    expect(rateLimitKey(forged)).toBe(rateLimitKey(alsoForged));
    expect(rateLimitKey(forged)).toBe('address:9.9.9.9');
  });

  it('falls back to the socket address when Fly reports nothing', () => {
    expect(rateLimitKey(request({}, {}, '10.0.0.7'))).toBe('address:10.0.0.7');
  });

  it('gives each session its own budget behind a shared proxy address', () => {
    const headers = { 'fly-client-ip': '9.9.9.9' };
    const first = rateLimitKey(request({ jcb_race_session: 'aaa' }, headers));
    const second = rateLimitKey(request({ jcb_race_session: 'bbb' }, headers));
    expect(first).not.toBe(second);
    expect(first).toMatch(/^session:[0-9a-f]{32}$/);
  });

  it('keeps one session on one key regardless of unrelated cookies', () => {
    const headers = { 'fly-client-ip': '9.9.9.9' };
    expect(rateLimitKey(request({ jcb_race_session: 'aaa', other: 'x' }, headers))).toBe(
      rateLimitKey(request({ jcb_race_session: 'aaa' }, headers)),
    );
  });
});
