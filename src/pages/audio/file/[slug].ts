import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const prerender = false;

type RangeParse =
  | { kind: 'none' }
  | { kind: 'malformed' }
  | { kind: 'unsatisfiable' }
  | { kind: 'ok'; offset: number; length: number };

function parseRangeHeader(header: string | null, size: number): RangeParse {
  if (!header) return { kind: 'none' };
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) return { kind: 'malformed' };
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end)) return { kind: 'malformed' };
  if (start > end || end >= size) return { kind: 'unsatisfiable' };
  return { kind: 'ok', offset: start, length: end - start + 1 };
}

export const GET: APIRoute = async (context) => {
  const slug = context.params.slug;
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) {
    return new Response('not found', { status: 404 });
  }

  const collection = await getCollection('audio-tracks');
  const entry = collection.find((e) => e.id === slug);
  if (!entry) return new Response('not found', { status: 404 });

  const env = (context.locals as any).runtime.env as Env;
  const key = (entry.data as any).file as string;

  const rangeHeader = context.request.headers.get('range');
  // First fetch without range to know total size.
  const head = await env.AUDIO.get(key);
  if (!head) return new Response('not found', { status: 404 });
  const size = head.size;

  const range = parseRangeHeader(rangeHeader, size);

  if (range.kind === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: {
        'content-range': `bytes */${size}`,
        'accept-ranges': 'bytes',
      },
    });
  }

  if (range.kind === 'ok') {
    const partial = await env.AUDIO.get(key, { range: { offset: range.offset, length: range.length } });
    if (!partial) return new Response('not found', { status: 404 });
    return new Response(partial.body, {
      status: 206,
      headers: {
        'content-type': 'audio/mpeg',
        'accept-ranges': 'bytes',
        'content-range': `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`,
        'content-length': String(range.length),
        'cache-control': 'public, max-age=31536000, immutable',
        'content-disposition': `inline; filename="${slug}.mp3"`,
      },
    });
  }

  // kind === 'none' or 'malformed' -> serve full file with 200
  return new Response(head.body, {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      'accept-ranges': 'bytes',
      'content-length': String(size),
      'cache-control': 'public, max-age=31536000, immutable',
      'content-disposition': `inline; filename="${slug}.mp3"`,
    },
  });
};
