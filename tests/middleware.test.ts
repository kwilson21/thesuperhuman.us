import { describe, it, expect, vi } from 'vitest';
import { onRequest } from '~/middleware';

function makeContext(url: string, hostHeader?: string) {
  const u = new URL(url);
  const headers = new Headers();
  if (hostHeader) headers.set('host', hostHeader);
  return {
    url: u,
    request: new Request(url, { headers }),
    rewrite: vi.fn(async (target: string | URL) => {
      const rewritten = typeof target === 'string' ? new URL(target, u) : target;
      return new Response('rewritten:' + rewritten.pathname, { status: 200 });
    }),
  } as any;
}

describe('middleware.onRequest', () => {
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
