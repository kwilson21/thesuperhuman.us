import { defineMiddleware } from 'astro:middleware';
import { rewritePathForHost } from '~/lib/host-routing';

export const onRequest = defineMiddleware(async (context, next) => {
  const host = context.request.headers.get('host') ?? context.url.host;
  const rewritten = rewritePathForHost(host, context.url.pathname);
  if (rewritten) {
    return context.rewrite(rewritten);
  }
  return next();
});
