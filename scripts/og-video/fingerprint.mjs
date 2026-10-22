// What makes a link-preview render current: the encoder settings and a digest of the local files a
// scene loaded. Shared by render.mjs, stale.mjs and tests/lib/og-media.test.ts. Node built-ins only,
// so the stale check runs in CI before npm ci.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const WIDTH = 1200;
export const HEIGHT = 630;
export const FPS = 30;

export const ENCODE = [
  '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
  '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p`,
  // Scenes are flat colour and type: tune for animation, and spend more bits on flat areas so the
  // paper and soft artwork masks do not band in predicted frames. x264's output depends on its
  // thread count, so pin it rather than let it follow the CPU count.
  '-c:v', 'libx264', '-threads', '6', '-preset', 'slow', '-tune', 'animation', '-x264-params', 'aq-mode=3', '-crf', '20', '-maxrate', '3M', '-bufsize', '6M',
  '-profile:v', 'high', '-g', String(FPS * 2),
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-movflags', '+faststart',
];
// Recorded with each scene, so a change to these settings re-encodes without being taken for a
// rendering difference.
export const ENCODING = createHash('sha256').update(JSON.stringify(ENCODE)).digest('hex').slice(0, 16);

// A digest of each input's path and bytes, in the order given (render.mjs sorts them).
export function sourceHash(root, inputs) {
  const digest = createHash('sha256');
  for (const input of inputs) digest.update(`${input}\0`).update(readFileSync(join(root, input))).update('\0');
  return digest.digest('hex').slice(0, 16);
}
