interface PagesRequestContext {
  readonly request: Request;
  readonly env?: Readonly<Record<string, unknown>>;
}

/**
 * Reads the upstream origin a deployment was configured with. Self-hosted
 * deployments set these in the Pages project; the fallback keeps an existing
 * deployment working without a configuration change.
 */
export function upstreamOrigin(
  context: PagesRequestContext,
  name: string,
  fallback: string,
): string {
  const configured = context.env?.[name];
  return typeof configured === 'string' && configured.trim() !== '' ? configured.trim() : fallback;
}

export async function proxyRequest(
  context: PagesRequestContext,
  upstreamOrigin: string,
): Promise<Response> {
  const incoming = new URL(context.request.url);
  const target = new URL(upstreamOrigin);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const method = context.request.method;
  const headers = new Headers(context.request.headers);

  // The upstream services are not browser-facing from an Activity. Removing the
  // iframe origin keeps their CORS policy independent from Discord's proxy host.
  headers.delete('host');
  headers.delete('origin');

  const response = await fetch(target, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? null : context.request.body,
    redirect: 'manual',
  });

  return new Response(response.body, response);
}
