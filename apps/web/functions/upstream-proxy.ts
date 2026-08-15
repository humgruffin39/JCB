interface PagesRequestContext {
  readonly request: Request;
}

export async function proxyRequest(
  context: PagesRequestContext,
  upstreamOrigin: string,
): Promise<Response> {
  const incoming = new URL(context.request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, upstreamOrigin);
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
