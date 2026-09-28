import { describe, expect, it } from 'vitest';
import { lyftBonus } from '~/data/profile';
import {
  barsPath, capacityCells, codeRows, easeOutCubic, formatFigure, parseFigure, signalFrame, waveformPeaks,
} from '~/lib/home-motion';

describe('figures', () => {
  it('reads and writes the Lyft capacity figures', () => {
    const before = parseFigure(lyftBonus.before)!;
    const after = parseFigure(lyftBonus.after)!;
    expect(before).toEqual({ prefix: '', value: 5000, suffix: '' });
    expect(after).toEqual({ prefix: '', value: 100000, suffix: '+' });
    expect(formatFigure(after)).toBe(lyftBonus.after);
    expect(formatFigure(after, 41234.6)).toBe('41,235+');
  });

  it('declines text that is not one figure', () => {
    expect(parseFigure('about ten')).toBeNull();
    expect(parseFigure('3 to 5')).toBeNull();
  });

  it('draws one cell per unit of the old capacity, within the layout limit', () => {
    expect(capacityCells(parseFigure('5,000')!, parseFigure('100,000+')!)).toBe(20);
    expect(capacityCells(parseFigure('1')!, parseFigure('1,000')!)).toBe(40);
    expect(capacityCells(parseFigure('0')!, parseFigure('10')!)).toBe(1);
  });

  it('eases a count toward its end', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('signal waveform', () => {
  it('is the same on the server and in the browser', () => {
    expect(waveformPeaks(48)).toEqual(waveformPeaks(48));
    expect(waveformPeaks(48)).not.toEqual(waveformPeaks(48, 8));
  });

  it('fades in and out and stays within range', () => {
    const peaks = waveformPeaks(96);
    expect(peaks).toHaveLength(96);
    expect(peaks.every(peak => peak >= 0 && peak <= 1)).toBe(true);
    expect(peaks[0]).toBe(0);
    expect(Math.max(...peaks.slice(30, 66))).toBeGreaterThan(0.5);
  });

  it('is silent at either edge of the viewport', () => {
    const peaks = waveformPeaks(24);
    expect(signalFrame(peaks, 0).every(height => Math.abs(height) < 1e-9)).toBe(true);
    expect(signalFrame(peaks, 1).every(height => Math.abs(height) < 1e-9)).toBe(true);
    expect(Math.max(...signalFrame(peaks, 0.5))).toBeGreaterThan(0.4);
  });

  it('draws bars up or down from the zero line and skips silent ones', () => {
    expect(barsPath([1, 0, 0.5], { width: 30, mid: 50, depth: 40, direction: 'up', fill: 0.5 }))
      .toBe('M2.5 10h5v40h-5zM22.5 30h5v20h-5z');
    expect(barsPath([1], { width: 10, mid: 50, depth: 40, direction: 'down', fill: 0.5 }))
      .toBe('M2.5 50h5v40h-5z');
  });
});

describe('code rows', () => {
  it('are deterministic, indented sensibly, and use the given tones', () => {
    const rows = codeRows(30);
    expect(rows).toEqual(codeRows(30));
    expect(rows.every(row => row.indent >= 0 && row.indent <= 4)).toBe(true);
    expect(rows.every(row => row.segments.length >= 1 && row.segments.every(segment => segment.tone >= 0 && segment.tone < 5))).toBe(true);
  });
});
