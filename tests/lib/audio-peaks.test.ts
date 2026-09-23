import { describe, expect, it } from 'vitest';
import { parsePeaks, peaksFromChannels, peaksFromWav, waveformRects } from '../../src/lib/audio-peaks';

// A stereo WAV with a quiet first half and a loud second half, plus a LIST chunk before fmt.
function wav({ bits = 16, float = false, frames = 44_100 } = {}) {
  const bytes = bits / 8, block = bytes * 2, list = 12;
  const buffer = Buffer.alloc(12 + (8 + list) + 24 + 8 + frames * block);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8);
  buffer.write('LIST', 12); buffer.writeUInt32LE(list, 16);
  let at = 20 + list;
  buffer.write('fmt ', at); buffer.writeUInt32LE(16, at + 4); buffer.writeUInt16LE(float ? 3 : 1, at + 8); buffer.writeUInt16LE(2, at + 10);
  buffer.writeUInt32LE(44_100, at + 12); buffer.writeUInt32LE(44_100 * block, at + 16); buffer.writeUInt16LE(block, at + 20); buffer.writeUInt16LE(bits, at + 22);
  at += 24; buffer.write('data', at); buffer.writeUInt32LE(frames * block, at + 4); at += 8;
  for (let frame = 0; frame < frames; frame++) {
    const level = (frame < frames / 2 ? .2 : .8) * Math.sin(frame / 7);
    for (let channel = 0; channel < 2; channel++, at += bytes) {
      if (float) buffer.writeFloatLE(level, at);
      else if (bits === 16) buffer.writeInt16LE(Math.round(level * 32767), at);
      else buffer.writeIntLE(Math.round(level * 8388607), at, 3);
    }
  }
  return buffer;
}
const reader = (buffer: Buffer, log: number[] = []) => async (start: number, end: number) => {
  log.push(end - start);
  return buffer.buffer.slice(buffer.byteOffset + start, buffer.byteOffset + end) as ArrayBuffer;
};

describe('audio peaks', () => {
  it('takes the loudest sample per bar across channels and scales to 0-100', () => {
    const left = new Float32Array([0.1, -0.2, 0, 0, 0.5, 0.25, 0, 0]);
    const right = new Float32Array([0, 0, -0.4, 0.1, 0, 0, 0, 0]);
    expect(peaksFromChannels([left, right], 4)).toEqual([40, 80, 100, 0]);
    expect(peaksFromChannels([new Float32Array(4)], 2)).toEqual([0, 0]);
    expect(peaksFromChannels([], 4)).toEqual([]);
  });

  it('accepts only short lists of whole numbers from 0 to 100', () => {
    const valid = Array.from({ length: 16 }, () => 50);
    expect(parsePeaks(valid)).toEqual(valid);
    expect(parsePeaks(JSON.stringify(valid))).toEqual(valid);
    expect(parsePeaks([...valid.slice(1), 101])).toBeNull();
    expect(parsePeaks([...valid.slice(1), 1.5])).toBeNull();
    expect(parsePeaks(valid.slice(1))).toBeNull();
    expect(parsePeaks('not json')).toBeNull();
    expect(parsePeaks(null)).toBeNull();
  });

  it('draws centered bars with a visible minimum height', () => {
    const rects = waveformRects([0, 100]);
    expect(rects.match(/<rect /g)).toHaveLength(2);
    expect(rects).toContain('y="19.00" width="96.00" height="2.00"');
    expect(rects).toContain('y="0.00" width="96.00" height="40.00"');
  });

  it('measures every sample, so a single short transient still shows', async () => {
    const frames = 44_100 * 60, file = wav({ frames: 0 });
    const silent = Buffer.concat([file, Buffer.alloc(frames * 4)]);
    silent.writeUInt32LE(silent.length - 8, 4);
    silent.writeUInt32LE(frames * 4, file.length - 4);
    const loudFrame = Math.floor(frames / 3) + 1001;
    silent.writeInt16LE(20_000, file.length + loudFrame * 4);
    const reads: number[] = [];
    const peaks = (await peaksFromWav(reader(silent, reads), silent.length))!;
    expect(peaks[Math.floor(loudFrame * 160 / frames)]).toBe(100);
    expect(peaks.filter(peak => peak > 0)).toHaveLength(1);
    expect(Math.max(...reads)).toBeLessThanOrEqual(1024 * 1024);
  });

  it('reads WAV peaks in bounded slices without decoding the whole file', async () => {
    for (const options of [{ bits: 16 }, { bits: 24 }, { bits: 32, float: true }]) {
      const file = wav(options);
      const reads: number[] = [];
      const peaks = (await peaksFromWav(reader(file, reads), file.length, 16))!;
      expect(peaks).toHaveLength(16);
      expect(Math.max(...peaks.slice(0, 7))).toBeLessThanOrEqual(30);
      expect(Math.min(...peaks.slice(9))).toBeGreaterThanOrEqual(90);
      expect(Math.max(...reads)).toBeLessThanOrEqual(1024 * 1024);
    }
  });

  it('skips WAV files it cannot read as PCM', async () => {
    const file = wav();
    file.writeUInt16LE(2, 32 + 8);
    expect(await peaksFromWav(reader(file), file.length)).toBeNull();
    expect(await peaksFromWav(reader(Buffer.from('not a wav file at all')), 21)).toBeNull();
  });
});
