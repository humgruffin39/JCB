interface PagesRequestContext {
  readonly request: Request;
}

const API_ORIGIN = 'https://jcb-racing-api.fly.dev';

export async function onRequest(context: PagesRequestContext): Promise<Response> {
  const incoming = new URL(context.request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, API_ORIGIN);
  const method = context.request.method;
  const response = await fetch(target, {
    method,
    headers: context.request.headers,
    body: method === 'GET' || method === 'HEAD' ? null : context.request.body,
    redirect: 'manual',
  });
  return new Response(response.body, response);
}
