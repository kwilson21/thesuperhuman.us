import { describe, it, expect, vi } from 'vitest';
import { onRequest } from '~/middleware';
import { verifyOwnerAccess } from '~/lib/owner-access';

vi.mock('~/lib/owner-access', () => ({ verifyOwnerAccess: vi.fn(async () => null) }));

function makeContext(url: string, hostHeader?: string) {
  const u = new URL(url);
  const headers = new Headers();
  if (hostHeader) headers.set('host', hostHeader);
  return {
    url: u,
    request: new Request(url, { headers }),
    locals: { runtime: { env: {} } },
    rewrite: vi.fn(async (target: string | URL) => {
      const rewritten = typeof target === 'string' ? new URL(target, u) : target;
      return new Response('rewritten:' + rewritten.pathname, { status: 200 });
    }),
  } as any;
}

describe('middleware.onRequest', () => {
  it('fails the build when an owner route is accidentally prerendered', async () => {
    const ctx = makeContext('https://thesuperhuman.us/owner');
    ctx.isPrerendered = true;
    await expect(onRequest(ctx, vi.fn())).rejects.toThrow('Owner routes must be server-rendered');
  });
  it('rejects unauthenticated owner routes without exposing a cacheable response', async () => {
    vi.mocked(verifyOwnerAccess).mockResolvedValueOnce(null);
    const ctx = makeContext('https://thesuperhuman.us/owner/requests');
    const next = vi.fn(async () => new Response('private content'));
    const response = (await onRequest(ctx, next)) as Response;
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(next).not.toHaveBeenCalled();
  });

  it('passes verified owner identity to routes and marks their responses private', async () => {
    vi.mocked(verifyOwnerAccess).mockResolvedValueOnce({ email: 'owner@example.com' });
    const ctx = makeContext('https://thesuperhuman.us/owner');
    const next = vi.fn(async () => new Response('private content'));
    const response = (await onRequest(ctx, next)) as Response;
    expect(ctx.locals.owner).toEqual({ email: 'owner@example.com' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('allows only originless, cookieless native OAuth form exchanges through the form guard', async () => {
    const attempt = async (path: string, headers: Record<string, string> = {}, method = 'POST', origin = 'https://thesuperhuman.us') => {
      const ctx = makeContext(origin + path);
      ctx.request = new Request(ctx.url, { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers } });
      return (await onRequest(ctx, async () => new Response('next'))) as Response;
    };
    expect((await attempt('/api/publication/token')).status).toBe(200);
    const rejectedHeaders: Record<string, string>[] = [{ origin: 'https://evil.example' }, { origin: 'null' }, { cookie: 'session=x' }, { 'sec-fetch-site': 'cross-site' }];
    for (const headers of rejectedHeaders) {
      expect((await attempt('/api/publication/token', headers)).status).toBe(403);
    }
    expect((await attempt('/api/publication/token', {}, 'PUT')).status).toBe(403);
    expect((await attempt('/api/publication/token', {}, 'POST', 'https://audio.thesuperhuman.us')).status).toBe(403);
    for (const path of ['/api/publication/authorize', '/api/contact', '/api/publication/token/']) {
      expect((await attempt(path)).status).toBe(403);
      expect((await attempt(path, { origin: 'https://thesuperhuman.us' })).status).toBe(200);
    }
  });

  it('passes through for the software host', async () => {
    const ctx = makeContext('https://thesuperhuman.us/', 'thesuperhuman.us');
    const next = vi.fn(async () => new Response('next', { status: 200 }));
    const res = (await onRequest(ctx, next)) as Response;
    expect(next).toHaveBeenCalled();
    expect(ctx.rewrite).not.toHaveBeenCalled();
    expect(await res.text()).toBe('next');
  });

  it('rewrites root on the audio host', async () => {
    const ctx = makeContext('https://audio.thesuperhuman.us/', 'audio.thesuperhuman.us');
    const next = vi.fn(async () => new Response('next', { status: 200 }));
    await onRequest(ctx, next);
    expect(ctx.rewrite).toHaveBeenCalledWith('/audio/');
    expect(next).not.toHaveBeenCalled();
  });

  it('rewrites /about on the audio host', async () => {
    const ctx = makeContext('https://audio.thesuperhuman.us/about', 'audio.thesuperhuman.us');
    const next = vi.fn(async () => new Response('next', { status: 200 }));
    await onRequest(ctx, next);
    expect(ctx.rewrite).toHaveBeenCalledWith('/audio/about');
  });

  it('does not rewrite /api/* on the audio host', async () => {
    const ctx = makeContext('https://audio.thesuperhuman.us/api/audio-inquiry', 'audio.thesuperhuman.us');
    const next = vi.fn(async () => new Response('next', { status: 200 }));
    await onRequest(ctx, next);
    expect(ctx.rewrite).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('falls back to URL.host when the Host header is missing', async () => {
    const ctx = makeContext('https://audio.thesuperhuman.us/', undefined);
    const next = vi.fn(async () => new Response('next', { status: 200 }));
    await onRequest(ctx, next);
    expect(ctx.rewrite).toHaveBeenCalledWith('/audio/');
  });
});
