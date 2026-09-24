import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { crc32, pngProblem } from '../../scripts/screenshots/verify-png.mjs';

const png = (width = 40, height = 30) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 120, b: 40, alpha: 1 } } }).png().toBuffer();

/** Finds a chunk by type and returns its offset and length. */
function chunk(buffer: Buffer, type: string) {
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    if (buffer.toString('latin1', offset + 4, offset + 8) === type) return { offset, length };
    offset += 12 + length;
  }
  throw new Error(`no ${type}`);
}

/** Replaces a chunk's data and writes a matching CRC, so only the content is wrong. */
function withChunkData(buffer: Buffer, type: string, data: Buffer) {
  const { offset, length } = chunk(buffer, type);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([buffer.subarray(0, offset), head, data, crc, buffer.subarray(offset + 12 + length)]);
}

describe('PNG verification', () => {
  it('accepts a PNG from an encoder, including a tall one', async () => {
    expect(pngProblem(await png())).toBeNull();
    expect(pngProblem(await png(1280, 6000))).toBeNull();
  });

  it('rejects a file that only starts like a PNG', async () => {
    const valid = await png();
    expect(pngProblem(Buffer.concat([valid.subarray(0, 8), Buffer.from('<html>')]))).toMatch(/truncated/);
    expect(pngProblem(Buffer.from('not a png at all'))).toBe('missing PNG signature');
  });

  it('rejects a flipped byte, a cut-off file and trailing data', async () => {
    const valid = await png();
    const flipped = Buffer.from(valid);
    flipped[chunk(valid, 'IDAT').offset + 10] ^= 0xff;
    expect(pngProblem(flipped)).toMatch(/bad CRC in IDAT/);
    expect(pngProblem(valid.subarray(0, valid.length - 12))).toBe('missing IEND');
    expect(pngProblem(Buffer.concat([valid, Buffer.from('extra')]))).toBe('data after IEND');
  });

  it('rejects image data that does not decode to the promised size, even with valid CRCs', async () => {
    const valid = await png();
    const { offset, length } = chunk(valid, 'IDAT');
    const data = valid.subarray(offset + 8, offset + 8 + length);
    expect(pngProblem(withChunkData(valid, 'IDAT', data.subarray(0, data.length - 6)))).toMatch(/does not inflate|expected/);
    expect(pngProblem(withChunkData(valid, 'IDAT', Buffer.from('garbage bytes')))).toMatch(/does not inflate/);
    // A header that claims more rows than the data holds.
    const header = Buffer.from(valid.subarray(chunk(valid, 'IHDR').offset + 8, chunk(valid, 'IHDR').offset + 21));
    header.writeUInt32BE(31, 4);
    expect(pngProblem(withChunkData(valid, 'IHDR', header))).toMatch(/expected/);
  });

  it('rejects an absurd size before inflating', async () => {
    const valid = await png();
    const { offset } = chunk(valid, 'IHDR');
    const header = Buffer.from(valid.subarray(offset + 8, offset + 21));
    header.writeUInt32BE(100_000, 0);
    expect(pngProblem(withChunkData(valid, 'IHDR', header))).toMatch(/unexpected size/);
  });
});
