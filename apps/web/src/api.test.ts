import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, apiRequest, exchangeActivityAuthorization } from './api.js';

describe('apiRequest', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the result from a valid API envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ apiVersion: 'v1', result: { ok: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(apiRequest<{ ok: boolean }>('/api/v1/test')).resolves.toEqual({ ok: true });
  });

  it('keeps the HTTP status and API error code for callers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            apiVersion: 'v1',
            error: { code: 'AUTH_REQUIRED', message: 'Authentication required.' },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const request = apiRequest('/api/v1/test');
    const error = await request.catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
      message: 'Authentication required.',
    });
  });

  it('turns a request timeout into a recoverable API error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted')));
          }),
      ),
    );
    vi.useFakeTimers();

    const request = apiRequest('/api/v1/test');
    const rejection = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(rejection).resolves.toMatchObject({ status: 408, code: 'REQUEST_TIMEOUT' });
  });

  it('stores the Activity session credentials returned by the exchange endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          apiVersion: 'v1',
          result: {
            accessToken: 'discord-access',
            csrfToken: 'activity-csrf-token-with-at-least-forty-characters',
            raceId: 'race-1',
            expiresAt: 1_787_300_000_000,
            edgeAccessToken: 'edge-access',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      exchangeActivityAuthorization({ code: 'code', instanceId: 'instance-1' }),
    ).resolves.toMatchObject({ raceId: 'race-1', accessToken: 'discord-access' });

    expect(sessionStorage.getItem('jcb.csrf:race')).toBe(
      'activity-csrf-token-with-at-least-forty-characters',
    );
    expect(sessionStorage.getItem('jcb.edge-token:race-1')).toBe('edge-access');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/activity/exchange',
      expect.objectContaining({
        body: JSON.stringify({ code: 'code', instanceId: 'instance-1' }),
      }),
    );
  });

  it('rejects a malformed Activity exchange before storing credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            apiVersion: 'v1',
            result: { accessToken: 'discord-access', csrfToken: '', raceId: 'race-1' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await expect(
      exchangeActivityAuthorization({ code: 'code', instanceId: 'instance-1' }),
    ).rejects.toMatchObject({ code: 'ACTIVITY_SESSION_INVALID' });
    expect(sessionStorage.getItem('jcb.csrf:race')).toBeNull();
  });
});
