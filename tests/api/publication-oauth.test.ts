import { it, expect, vi } from 'vitest';
import { publicationOAuthRoute } from '~/lib/publication/oauth';

it('serves discovery, registers clients, and rejects missing/invalid bearer tokens using the real OAuth library', async () => {
  const values = new Map<string, string>();
  const kv = { put: async (key: string, value: string) => { values.set(key, value); },
    get: async (key: string, type?: string | { type: string }) => { const value = values.get(key) ?? null; return value && (type === 'json' || (typeof type === 'object' && type.type === 'json')) ? JSON.parse(value) : value; },
    delete: async (key: string) => { values.delete(key); }, list: async () => ({ keys: [], list_complete: true }) };
  const env = { OAUTH_KV: kv, PUBLICATION_DB: {}, PUBLICATION_OWNER_ID: '10987837', PUBLICATION_PROJECTS: 'threadline,other',
    PUBLICATION_GITHUB_CLIENT_ID: 'test-client', PUBLICATION_GITHUB_CLIENT_SECRET: 'test-secret', PUBLICATION_COOKIE_KEY: btoa('k'.repeat(32)) };
  const call = (path: string, init?: RequestInit) => publicationOAuthRoute({
    request: new Request('https://thesuperhuman.us' + path, init), locals: { runtime: { env, ctx: { waitUntil() {} } } },
  } as any);
  const meta = await call('/.well-known/oauth-protected-resource/api/publication/mcp');
  expect(meta.status).toBe(200);
  expect((await meta.json() as any).resource).toBe('https://thesuperhuman.us/api/publication/mcp');
  const server = await call('/.well-known/oauth-authorization-server');
  expect((await server.json() as any).code_challenge_methods_supported).toContain('S256');
  const registration = await call('/api/publication/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'test-chat', redirect_uris: ['https://chatgpt.com/callback'], token_endpoint_auth_method: 'none' }) });
  expect(registration.status).toBe(201);
  const clientId = (await registration.json() as any).client_id;
  expect(clientId).toBeTruthy();
  for (const authorization of ['', 'Bearer invalid']) {
    const denied = await call('/api/publication/mcp', { method: 'POST', headers: { authorization,
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{}' });
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toContain('oauth-protected-resource');
  }
  expect((await call('/api/publication/register', { method: 'POST', body: 'x'.repeat(32769) })).status).toBe(413);
  const verifier = 'v'.repeat(43);
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'https://chatgpt.com/callback',
    scope: 'publication:threadline publication:other', resource: 'https://thesuperhuman.us/api/publication/mcp',
    state: 'client-state', code_challenge: challenge, code_challenge_method: 'S256' });
  const page = await call('/api/publication/authorize?' + params);
  expect(page.status).toBe(200);
  const nonce = /name="nonce" value="([^"]+)"/.exec(await page.text())![1];
  const consent = await call('/api/publication/authorize', { method: 'POST', headers: { origin: 'https://thesuperhuman.us',
    cookie: page.headers.get('set-cookie')!.split(';')[0] }, body: new URLSearchParams({ nonce }) });
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'upstream' })).mockResolvedValueOnce(Response.json({ id: 10987837 }));
  vi.stubGlobal('fetch', fetcher);
  let callback: Response;
  try { callback = await call('/api/publication/callback?code=github-code&state=' + nonce,
    { headers: { cookie: consent.headers.get('set-cookie')!.split(';')[0] } }); }
  finally { vi.unstubAllGlobals(); }
  expect(callback!.status).toBe(302);
  const code = new URL(callback!.headers.get('location')!).searchParams.get('code')!;
  const tokens = await call('/api/publication/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier,
      redirect_uri: 'https://chatgpt.com/callback', resource: 'https://thesuperhuman.us/api/publication/mcp' }) });
  expect(tokens.status).toBe(200);
  const token = await tokens.json() as any;
  const refresh = await call('/api/publication/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: token.refresh_token,
      scope: 'publication:threadline', resource: 'https://thesuperhuman.us/api/publication/mcp' }) });
  expect(refresh.status).toBe(200);
  const narrowed = await refresh.json() as any;
  const denied = await call('/api/publication/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + narrowed.access_token,
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_project_progress', arguments: { projectId: 'other' } } }) });
  expect(denied.status).toBe(200);
  expect((await denied.json() as any).result.content[0].text).toContain('forbidden');
});
