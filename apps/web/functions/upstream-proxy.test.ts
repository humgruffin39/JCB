import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyRequest } from './upstream-proxy.js';

describe('proxyRequest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves the path, query, authorization and body without forwarding browser origin', async () => {
    let receivedTarget: RequestInfo | URL | undefined;
    let receivedInit: RequestInit | undefined;
    const upstream = vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
      receivedTarget = target;
      receivedInit = init;
      return Response.json({ ok: true }, { status: 201 });
    });
    vi.stubGlobal('fetch', upstream);
    const request = new Request('https://activity.example/edge/v1/races/race-1/release?x=1', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
        origin: 'https://123.discordsays.com',
      },
      body: JSON.stringify({ value: 1 }),
    });

    const response = await proxyRequest({ request }, 'https://edge.example');

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(upstream).toHaveBeenCalledOnce();
    expect(String(receivedTarget)).toBe('https://edge.example/edge/v1/races/race-1/release?x=1');
    expect(receivedInit?.method).toBe('POST');
    const headers = new Headers(receivedInit?.headers);
    expect(headers.get('authorization')).toBe('Bearer token');
    expect(headers.has('origin')).toBe(false);
    expect(await new Response(receivedInit?.body).json()).toEqual({ value: 1 });
  });

  it('does not attach a body to GET requests', async () => {
    let receivedInit: RequestInit | undefined;
    const upstream = vi.fn(async (_target: RequestInfo | URL, init?: RequestInit) => {
      receivedInit = init;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', upstream);

    await proxyRequest(
      { request: new Request('https://activity.example/api/v1/time') },
      'https://api.example',
    );

    expect(receivedInit?.body).toBeNull();
  });
});
