import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('sends the Activity instance header while refreshing CSRF credentials', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('window', {
    location: {
      search: '?frame_id=frame-1&instance_id=instance-1&platform=desktop',
    },
  });
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        apiVersion: 'v1',
        result: { csrfToken: 'activity-csrf-token-with-at-least-forty-characters' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const { refreshCsrfToken } = await import('./api.js');

  await refreshCsrfToken();

  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  expect(new Headers(init.headers).get('x-jcb-activity-instance')).toBe('instance-1');
});
