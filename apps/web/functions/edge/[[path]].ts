import { proxyRequest, upstreamOrigin } from '../upstream-proxy.js';

const DEFAULT_EDGE_ORIGIN = 'https://jcb-race-edge.hugh-fabre.workers.dev';

export async function onRequest(context: {
  readonly request: Request;
  readonly env?: Readonly<Record<string, unknown>>;
}): Promise<Response> {
  return proxyRequest(context, upstreamOrigin(context, 'EDGE_ORIGIN', DEFAULT_EDGE_ORIGIN));
}
