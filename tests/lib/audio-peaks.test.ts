import { describe, expect, it } from 'vitest';
import { parsePeaks, peaksFromChannels, waveformRects } from '../../src/lib/audio-peaks';

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
});
