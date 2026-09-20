import { expect, it } from 'vitest';
import { mediaRange, streamMusic } from '~/lib/music-media';
it('resolves full, bounded, open and suffix ranges without overrunning the file', () => {
  expect(mediaRange(null, 100)).toBeNull();
  expect(mediaRange('bytes=10-19', 100)).toEqual({ offset: 10, length: 10 });
  expect(mediaRange('bytes=90-', 100)).toEqual({ offset: 90, length: 10 });
  expect(mediaRange('bytes=-20', 100)).toEqual({ offset: 80, length: 20 });
  expect(mediaRange('bytes=90-999', 100)).toEqual({ offset: 90, length: 10 });
  expect(mediaRange('bytes=100-', 100)).toBe('invalid');
  expect(mediaRange('bytes=0-1,4-5', 100)).toBe('invalid');
});

it('allows public media responses to use shared caching', async () => {
  const bucket = {
    head: async () => ({ size: 4 }),
    get: async () => ({ body: new Uint8Array([1, 2, 3, 4]) }),
  } as unknown as R2Bucket;
  const response = await streamMusic(new Request('https://example.test/music/file/old-news/master'), bucket, {
    key: 'old-news/master.mp3', type: 'audio/mpeg',
  });
  expect(response.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=86400');
});
