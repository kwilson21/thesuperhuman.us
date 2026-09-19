import { defineMiddleware } from 'astro:middleware';
import { rewritePathForHost } from '~/lib/host-routing';
import { verifyOwnerAccess } from '~/lib/owner-access';

const ownerPrivateHeaders = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex, nofollow',
};

function withOwnerHeaders(response: Response) {
  for (const [name, value] of Object.entries(ownerPrivateHeaders)) response.headers.set(name, value);
  return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  const ownerPath = url.pathname === '/owner' || url.pathname.startsWith('/owner/');
  if (context.isPrerendered && ownerPath) throw new Error('Owner routes must be server-rendered.');
  if (!context.isPrerendered && ownerPath) {
    const owner = await verifyOwnerAccess(request, context.locals.runtime.env);
    if (!owner) return new Response('Owner access required.', { status: 403, headers: ownerPrivateHeaders });
    context.locals.owner = owner;
  }
  // OAuth clients exchange codes/PKCE or refresh tokens without browser Origin.
  // The token endpoint does not authenticate using cookies.
  const tokenExchange = url.origin === 'https://thesuperhuman.us'
    && url.pathname === '/api/publication/token' && request.method === 'POST'
    && !request.headers.has('origin') && !request.headers.has('cookie')
    && (!request.headers.has('sec-fetch-site') || request.headers.get('sec-fetch-site') === 'none')
    && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/x-www-form-urlencoded';
  if (!context.isPrerendered && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !tokenExchange) {
    const type = request.headers.get('content-type');
    const formLike = !type || ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']
      .some(formType => type.toLowerCase().includes(formType));
    if (formLike && request.headers.get('origin') !== url.origin) {
      return new Response(`Cross-site ${request.method} form submissions are forbidden`, { status: 403 });
    }
  }
  const host = context.isPrerendered ? context.url.host : context.request.headers.get('host') ?? context.url.host;
  const rewritten = rewritePathForHost(host, context.url.pathname);
  if (rewritten) {
    const response = await context.rewrite(rewritten);
    return ownerPath ? withOwnerHeaders(response) : response;
  }
  const response = await next();
  return ownerPath ? withOwnerHeaders(response) : response;
});
