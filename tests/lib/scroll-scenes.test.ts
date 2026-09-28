import { describe, expect, it } from 'vitest';
import { clamp01, sceneProgress } from '~/lib/scroll-scenes';

describe('sceneProgress', () => {
  const scene = { viewport: 800, start: 1, end: 0.25, topAtMaxScroll: -2000 };

  it('runs from the start line to the end line', () => {
    expect(sceneProgress({ ...scene, top: 900 })).toBe(0);
    expect(sceneProgress({ ...scene, top: 800 })).toBe(0);
    expect(sceneProgress({ ...scene, top: 500 })).toBeCloseTo(0.5);
    expect(sceneProgress({ ...scene, top: 200 })).toBe(1);
    expect(sceneProgress({ ...scene, top: -400 })).toBe(1);
  });

  it('finishes at the bottom of the page when the end line is out of reach', () => {
    const last = { ...scene, end: 0, topAtMaxScroll: 400 };
    expect(sceneProgress({ ...last, top: 600 })).toBeCloseTo(0.5);
    expect(sceneProgress({ ...last, top: 400 })).toBe(1);
  });

  it('shows the finished scene when it can never start', () => {
    expect(sceneProgress({ ...scene, top: 900, topAtMaxScroll: 850 })).toBe(1);
  });
});

it('clamps to the unit range', () => {
  expect(clamp01(-1)).toBe(0);
  expect(clamp01(0.4)).toBe(0.4);
  expect(clamp01(3)).toBe(1);
});
