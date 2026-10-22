import { expect, it, vi } from 'vitest';
import { openMessages, scrollShift } from '~/scripts/form-messages';

it('keeps an action that was on screen above the fold after messages open', () => {
  // The brief's first screen at 1280 x 800: two messages push Next's bottom from 768 to 837.
  expect(scrollShift(768, 837, 800)).toBe(53);
  // On a 390 x 844 phone Next's bottom moves from 823 to 892.
  expect(scrollShift(823, 892, 844)).toBe(64);
});

it('leaves an action that sat closer to the fold where it was, and never scrolls back up', () => {
  expect(scrollShift(792, 860, 800)).toBe(68);
  expect(scrollShift(500, 560, 800)).toBe(0);
  expect(scrollShift(700, 690, 800)).toBe(0);
});

it('never scrolls the focused field off the top', () => {
  expect(scrollShift(768, 837, 800, 40)).toBe(24);
  expect(scrollShift(768, 837, 800, 10)).toBe(0);
});

it('runs the update and returns its result without a browser layout', () => {
  const update = vi.fn(() => 'first field');
  expect(openMessages({} as HTMLElement, null, update)).toBe('first field');
  expect(update).toHaveBeenCalledOnce();
});
