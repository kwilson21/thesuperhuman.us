import { expect, it } from 'vitest';
import { mediaRange } from '~/lib/music-media';
it('resolves full, bounded, open and suffix ranges without overrunning the file', () => {
  expect(mediaRange(null, 100)).toBeNull();
  expect(mediaRange('bytes=10-19', 100)).toEqual({ offset: 10, length: 10 });
  expect(mediaRange('bytes=90-', 100)).toEqual({ offset: 90, length: 10 });
  expect(mediaRange('bytes=-20', 100)).toEqual({ offset: 80, length: 20 });
  expect(mediaRange('bytes=90-999', 100)).toEqual({ offset: 90, length: 10 });
  expect(mediaRange('bytes=100-', 100)).toBe('invalid');
  expect(mediaRange('bytes=0-1,4-5', 100)).toBe('invalid');
});
