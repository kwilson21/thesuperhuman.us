import { describe, it, expect, vi, afterEach } from 'vitest';
import { publicationLogin, publicationResource, type LoginEnv } from '~/lib/publication/oauth-login';
const origin = 'https://thesuperhuman.us';
const auth = { responseType: 'code', clientId: 'client', redirectUri: 'https://chatgpt.com/callback', scope: ['publication:threadline'],
  state: 'downstream-state', codeChallenge: 'a'.repeat(43), codeChallengeMethod: 'S256', resource: publicationResource };
function fixture(overrides = {}) {
  const complete = vi.fn(async () => ({ redirectTo: 'https://chatgpt.com/callback?code=issued' }));
  const env = { PUBLICATION_PROJECTS: 'threadline', PUBLICATION_OWNER_ID: '10987837',
    PUBLICATION_GITHUB_CLIENT_ID: 'public-client', PUBLICATION_GITHUB_CLIENT_SECRET: 'test-secret',
    PUBLICATION_COOKIE_KEY: btoa('k'.repeat(32)),
    OAUTH_PROVIDER: { parseAuthRequest: vi.fn(async () => ({ ...auth, ...overrides })),
      lookupClient: vi.fn(async () => ({ clientName: '<script>evil</script>' })), completeAuthorization: complete } } as unknown as LoginEnv;
  return { env, complete };
}
function cookie(response: Response) { return response.headers.get('set-cookie')!.split(';')[0]; }
async function start(env: LoginEnv) {
  const page = await publicationLogin(new Request(origin + '/api/publication/authorize'), env);
  const html = await page.text();
  const nonce = /name="nonce" value="([^"]+)"/.exec(html)![1];
  const response = await publicationLogin(new Request(origin + '/api/publication/authorize', { method: 'POST',
    headers: { origin, cookie: cookie(page) }, body: new URLSearchParams({ nonce }) }), env);
  return { page, html, response, nonce };
}
afterEach(() => vi.unstubAllGlobals());
describe('publication consent and GitHub identity', () => {
  it('permits the validated client return origin without copying callback paths or query values into CSP', async () => {
    for (const redirectUri of ['http://127.0.0.1:54321/callback?marker=private', 'https://chatgpt.com/callback?marker=private']) {
      const { env } = fixture({ redirectUri });
      const page = await publicationLogin(new Request(origin + '/api/publication/authorize'), env);
      const policy = page.headers.get('content-security-policy')!;
      expect(policy).toContain(`form-action 'self' https://github.com/login/oauth/authorize ${new URL(redirectUri).origin};`);
      expect(policy).not.toContain('marker');
    }
  });
  it('escapes client names, binds browser consent, and uses upstream PKCE without repository scopes', async () => {
    const { env } = fixture(); const { html, response, page } = await start(env);
    expect(html).not.toContain('<script>evil'); expect(html).toContain('&lt;script&gt;');
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('content-security-policy')).toContain("form-action 'self' https://github.com/login/oauth/authorize https://chatgpt.com;");
    expect(page.headers.get('referrer-policy')).toBe('same-origin');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const github = new URL(response.headers.get('location')!);
    expect(github.origin).toBe('https://github.com');
    expect(github.pathname).toBe('/login/oauth/authorize');
    expect(github.searchParams.get('scope')).toBe('');
    expect(github.searchParams.get('code_challenge_method')).toBe('S256');
    expect(github.searchParams.get('code_challenge')).toHaveLength(43);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  });
  it('rejects foreign resources, unknown project scopes, and absent downstream PKCE', async () => {
    for (const overrides of [{ resource: 'https://evil.example/mcp' }, { scope: ['publication:private'] }, { codeChallengeMethod: 'plain' }]) {
      const { env } = fixture(overrides);
      expect((await publicationLogin(new Request(origin + '/api/publication/authorize'), env)).status).toBe(400);
    }
  });
  it('rejects cross-site consent and callback state tampering before upstream calls', async () => {
    const { env, complete } = fixture(); const { response, nonce } = await start(env);
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const post = await publicationLogin(new Request(origin + '/api/publication/authorize', { method: 'POST',
      headers: { origin: 'https://evil.example', cookie: cookie(response) }, body: new URLSearchParams({ nonce }) }), env);
    expect(post.status).toBe(400);
    expect((await publicationLogin(new Request(origin + '/api/publication/callback?code=x&state=wrong',
      { headers: { cookie: cookie(response) } }), env)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  });
  it('grants only the verified owner and discards the upstream access token', async () => {
    const { env, complete } = fixture(); const { response, nonce } = await start(env);
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'upstream-secret' }))
      .mockResolvedValueOnce(Response.json({ id: 10987837 })); vi.stubGlobal('fetch', fetcher);
    const result = await publicationLogin(new Request(origin + '/api/publication/callback?code=x&state=' + nonce,
      { headers: { cookie: cookie(response) } }), env);
    expect(result.status).toBe(302);
    const grant = complete.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(grant[0].props).toEqual({ ownerId: '10987837', scopes: ['publication:threadline'] });
    expect(JSON.stringify(grant)).not.toContain('upstream-secret');
    expect(result.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(new URLSearchParams(fetcher.mock.calls[0][1].body).get('code_verifier')).toHaveLength(43);
  });
  it('denies another GitHub account and expired browser state', async () => {
    const { env, complete } = fixture(); const { response, nonce } = await start(env);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'token' }))
      .mockResolvedValueOnce(Response.json({ id: 123 })));
    const req = () => new Request(origin + '/api/publication/callback?code=x&state=' + nonce, { headers: { cookie: cookie(response) } });
    expect((await publicationLogin(req(), env)).status).toBe(400);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 700000);
    expect((await publicationLogin(req(), env)).status).toBe(400);
    clock.mockRestore(); expect(complete).not.toHaveBeenCalled();
  });
});
