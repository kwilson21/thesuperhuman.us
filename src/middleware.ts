import { defineMiddleware } from 'astro:middleware';
import { rewritePathForHost } from '~/lib/host-routing';

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
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
  const host = context.request.headers.get('host') ?? context.url.host;
  const rewritten = rewritePathForHost(host, context.url.pathname);
  if (rewritten) {
    return context.rewrite(rewritten);
  }
  return next();
});
