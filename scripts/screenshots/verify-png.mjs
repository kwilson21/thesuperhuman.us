#!/usr/bin/env node
// Decodes a PNG far enough to prove it is whole: every chunk's CRC, a valid header, and image data
// that inflates to exactly the size the header promises. The publish workflow runs it on each
// untrusted screenshot. Usage: node verify-png.mjs <file>; exits non-zero with the reason.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Samples per pixel and the bit depths allowed for each color type.
const COLOR_TYPES = { 0: [1, [1, 2, 4, 8, 16]], 2: [3, [8, 16]], 3: [1, [1, 2, 4, 8]], 4: [2, [8, 16]], 6: [4, [8, 16]] };
// Full-page screenshots are tall but bounded; this caps the memory an inflate can claim.
const MAX_DIMENSION = 32_000;
const MAX_RAW_BYTES = 256 * 1024 * 1024;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Returns null for a complete, decodable PNG, or the reason it is not. */
export function pngProblem(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) return 'missing PNG signature';
  let offset = 8;
  let header;
  let hasPalette = false;
  const data = [];
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) return 'truncated chunk';
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    if (length > 0x7fffffff || offset + 12 + length > buffer.length) return `truncated ${type} chunk`;
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== buffer.readUInt32BE(offset + 8 + length)) return `bad CRC in ${type}`;
    offset += 12 + length;
    if (!header) {
      if (type !== 'IHDR' || length !== 13) return 'first chunk is not IHDR';
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], compression: body[10], filter: body[11], interlace: body[12] };
      continue;
    }
    if (type === 'IHDR') return 'second IHDR';
    if (type === 'PLTE') hasPalette = true;
    if (type === 'IDAT') data.push(body);
    if (type === 'IEND') {
      if (length !== 0) return 'IEND has data';
      if (offset !== buffer.length) return 'data after IEND';
      break;
    }
    if (offset === buffer.length) return 'missing IEND';
  }
  if (!header) return 'missing IHDR';
  const { width, height, depth, color, compression, filter, interlace } = header;
  const kind = COLOR_TYPES[color];
  if (!kind || !kind[1].includes(depth)) return `invalid color type ${color} at depth ${depth}`;
  if (compression !== 0 || filter !== 0) return 'unknown compression or filter method';
  // Browsers never write interlaced screenshots, so there is no need to accept them.
  if (interlace !== 0) return 'interlaced images are not accepted';
  if (color === 3 && !hasPalette) return 'palette image without PLTE';
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) return `unexpected size ${width}×${height}`;
  if (!data.length) return 'no image data';
  const rowBytes = Math.ceil((width * kind[0] * depth) / 8);
  const expected = height * (1 + rowBytes);
  if (expected > MAX_RAW_BYTES) return 'image too large to verify';
  let raw;
  try {
    raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 });
  } catch (error) {
    return `image data does not inflate: ${error.message}`;
  }
  if (raw.length !== expected) return `image data is ${raw.length} bytes, expected ${expected}`;
  for (let row = 0; row < height; row++) if (raw[row * (1 + rowBytes)] > 4) return `unknown filter on row ${row}`;
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const problem = pngProblem(await readFile(process.argv[2]));
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}
