import { proxyRequest, upstreamOrigin } from '../upstream-proxy.js';

const DEFAULT_API_ORIGIN = 'https://jcb-racing-api.fly.dev';

export async function onRequest(context: {
  readonly request: Request;
  readonly env?: Readonly<Record<string, unknown>>;
}): Promise<Response> {
  return proxyRequest(context, upstreamOrigin(context, 'API_ORIGIN', DEFAULT_API_ORIGIN));
}
