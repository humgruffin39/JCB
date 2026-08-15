import { proxyRequest } from '../upstream-proxy.js';

const EDGE_ORIGIN = 'https://jcb-race-edge.hugh-fabre.workers.dev';

export async function onRequest(context: { readonly request: Request }): Promise<Response> {
  return proxyRequest(context, EDGE_ORIGIN);
}
