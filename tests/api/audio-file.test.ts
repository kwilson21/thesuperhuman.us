import { describe, it, expect, vi } from 'vitest';

vi.mock('astro:content', () => {
  return {
    getCollection: vi.fn(async () => [
      { id: 'slow-burn', data: { file: 'tracks/slow-burn.mp3' } },
    ]),
  };
});

import { GET } from '~/pages/audio/file/[slug]';

function makeR2(body = new Uint8Array([1, 2, 3, 4, 5]), size = 5) {
  return {
    head: vi.fn(async (_key: string) => ({ size })),
    get: vi.fn(async (_key: string, opts?: any) => {
      const range = opts?.range;
      if (range && range.offset !== undefined && range.length !== undefined) {
        const slice = body.slice(range.offset, range.offset + range.length);
        return {
          body: new Response(slice).body,
          size,
          range,
        };
      }
      return {
        body: new Response(body).body,
        size,
      };
    }),
  };
}

function makeContext(slug: string, rangeHeader?: string) {
  const headers = new Headers();
  if (rangeHeader) headers.set('range', rangeHeader);
  const audio = makeR2();
  return {
    params: { slug },
    request: new Request(`https://audio.thesuperhuman.us/file/${slug}`, { headers }),
    locals: { runtime: { env: { AUDIO: audio } } },
  } as any;
}

describe('GET /audio/file/[slug]', () => {
  it('streams the full file when no Range header is sent', async () => {
    const res = await GET(makeContext('slow-burn'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await GET(makeContext('unknown'));
    expect(res.status).toBe(404);
  });

  it('honours a Range header with 206 and Content-Range', async () => {
    const res = await GET(makeContext('slow-burn', 'bytes=1-3'));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 1-3/5');
    expect(res.headers.get('content-length')).toBe('3');
  });

  it('returns 416 with Content-Range:*/<size> for an out-of-range request', async () => {
    const res = await GET(makeContext('slow-burn', 'bytes=99-100'));
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */5');
  });

  it('returns 416 for an inverted range (start > end)', async () => {
    const res = await GET(makeContext('slow-burn', 'bytes=4-2'));
    expect(res.status).toBe(416);
  });

  it('ignores a malformed Range header and serves 200', async () => {
    const res = await GET(makeContext('slow-burn', 'malformed=foo'));
    expect(res.status).toBe(200);
  });
});
