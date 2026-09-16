export function mediaRange(header: string | null, size: number): { offset: number; length: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2]) || size < 1) return 'invalid';
  const suffix = !m[1];
  const start = suffix ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = suffix || !m[2] ? size - 1 : Math.min(size - 1, Number(m[2]));
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return 'invalid';
  return { offset: start, length: end - start + 1 };
}
export async function streamMusic(request: Request, bucket: R2Bucket, asset: { key: string; type: string }) {
  const head = await bucket.head(asset.key);
  if (!head) return new Response('Media unavailable', { status: 404 });
  const range = request.method === 'HEAD' ? null : mediaRange(request.headers.get('range'), head.size);
  if (range === 'invalid') return new Response(null, { status: 416, headers: { 'content-range': `bytes */${head.size}` } });
  const headers = new Headers({ 'content-type': asset.type, 'accept-ranges': 'bytes', 'content-length': String(range?.length ?? head.size), 'cache-control': 'private, max-age=0, must-revalidate', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline' });
  if (range) headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
  if (request.method === 'HEAD') return new Response(null, { headers });
  const object = await bucket.get(asset.key, range ? { range } : undefined);
  if (!object) return new Response('Media unavailable', { status: 404 });
  return new Response(object.body, { status: range ? 206 : 200, headers });
}
