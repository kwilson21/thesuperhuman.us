import type { APIRoute } from 'astro';
import { publicationLogin, publicationBase, publicationOrigin, publicationResource, type LoginEnv } from './oauth-login';
import { publicationMcp, type PublicationIdentity } from './mcp';

const paths = new Set([
  publicationBase + '/mcp', publicationBase + '/authorize', publicationBase + '/callback',
  publicationBase + '/token', publicationBase + '/register',
  '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource' + publicationBase + '/mcp',
]);

/** Bound before any parser, including anonymous client registration. */
async function bounded(request: Request): Promise<Request | null> {
  if (!request.body) return request;
  const reader = request.body.getReader();
  const parts: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 32768) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return new Request(request.url, { method: request.method, headers: request.headers, body: bytes });
}

export const publicationOAuthRoute: APIRoute = async ({ request, locals }) => {
  const url = new URL(request.url);
  const headers = { 'Cache-Control': 'no-store' };
  if (url.origin !== publicationOrigin || !paths.has(url.pathname)) return new Response('Not found', { status: 404, headers });
  const env = locals.runtime.env;
  if (!env.OAUTH_KV || !env.PUBLICATION_DB || !env.PUBLICATION_OWNER_ID || !env.PUBLICATION_GITHUB_CLIENT_ID
    || !env.PUBLICATION_GITHUB_CLIENT_SECRET || !env.PUBLICATION_COOKIE_KEY) {
    return new Response('Publication connection is not configured.', { status: 503, headers });
  }
  try {
    const limited = await bounded(request);
    if (!limited) return new Response('Request too large', { status: 413, headers });
    // Dynamic import keeps Worker-only OAuth runtime out of unrelated website routes.
    const { OAuthProvider } = await import('@cloudflare/workers-oauth-provider');
    const scopes = (env.PUBLICATION_PROJECTS ?? '').split(',').map(s => s.trim()).filter(Boolean).map(p => `publication:${p}`);
    const provider = new OAuthProvider<LoginEnv>({
      apiRoute: publicationResource,
      apiHandler: { async fetch(req, bindings, ctx) {
        const identity = (ctx as unknown as { props?: PublicationIdentity }).props;
        if (!identity || typeof identity.ownerId !== 'string' || !Array.isArray(identity.scopes)
          || identity.ownerId !== bindings.PUBLICATION_OWNER_ID || !identity.scopes.every(s => typeof s === 'string')) {
          return new Response('Forbidden', { status: 403 });
        }
        return publicationMcp(req, bindings, identity);
      } },
      defaultHandler: { fetch: publicationLogin },
      authorizeEndpoint: publicationBase + '/authorize', tokenEndpoint: publicationBase + '/token',
      clientRegistrationEndpoint: publicationBase + '/register',
      scopesSupported: scopes, accessTokenTTL: 3600, refreshTokenTTL: 2592000,
      allowPlainPKCE: false, allowImplicitFlow: false, clientIdMetadataDocumentEnabled: false,
      resourceMetadata: { resource: publicationResource, authorization_servers: [publicationOrigin], scopes_supported: scopes },
      // Refresh scope narrowing must also narrow the props consumed by MCP handlers.
      tokenExchangeCallback: options => ({ accessTokenProps: { ownerId: options.userId,
        scopes: options.requestedScope.filter(scope => options.scope.includes(scope) && scopes.includes(scope)) } }),
    });
    const response = await provider.fetch(limited, env as unknown as LoginEnv, locals.runtime.ctx);
    const wrapped = new Response(response.body, response);
    wrapped.headers.set('Cache-Control', 'no-store');
    return wrapped;
  } catch { return new Response('Publication connection unavailable.', { status: 503, headers }); }
};
