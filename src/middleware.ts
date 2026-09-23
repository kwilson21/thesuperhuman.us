import { defineMiddleware } from 'astro:middleware';
import { rewritePathForHost } from '~/lib/host-routing';
import { verifyOwnerAccess } from '~/lib/owner-access';

const ownerPrivateHeaders = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex, nofollow',
};

const studioPrivateHeaders = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };

function withOwnerHeaders(response: Response) {
  for (const [name, value] of Object.entries(ownerPrivateHeaders)) response.headers.set(name, value);
  return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  const ownerPage = url.pathname === '/owner' || url.pathname.startsWith('/owner/');
  const ownerApi = url.pathname === '/api/owner' || url.pathname.startsWith('/api/owner/');
  const ownerBoundary = ownerPage || ownerApi;
  const studioPage = url.pathname === '/studio' || url.pathname.startsWith('/studio/');
  const studioApi = url.pathname === '/api/studio' || url.pathname.startsWith('/api/studio/');
  const studioBoundary = studioPage || studioApi;
  if (context.isPrerendered && ownerPage) throw new Error('Owner routes must be server-rendered.');
  if (!context.isPrerendered && ownerBoundary) {
    const owner = await verifyOwnerAccess(request, context.locals.runtime.env);
    if (!owner) return new Response('Owner access required.', { status: 403, headers: ownerPrivateHeaders });
    context.locals.owner = owner;
  }
  if (!context.isPrerendered && ownerApi && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    && request.headers.get('origin') !== url.origin) {
    return new Response(`Cross-site ${request.method} owner actions are forbidden`, { status: 403, headers: ownerPrivateHeaders });
  }
  if (!context.isPrerendered && studioApi && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    && request.headers.get('origin') !== url.origin) {
    return new Response('Cross-site studio actions are forbidden', { status: 403, headers: studioPrivateHeaders });
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
    return ownerBoundary ? withOwnerHeaders(response) : response;
  }
  const response = await next();
  if (ownerBoundary) return withOwnerHeaders(response);
  if (studioBoundary) {
    for (const [name, value] of Object.entries(studioPrivateHeaders)) response.headers.set(name, value);
  }
  return response;
});
