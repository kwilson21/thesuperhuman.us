import { afterEach, expect, it, vi } from 'vitest';
import { setupNextStep } from '../../src/scripts/next-step';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('jumps to the named control, highlights it and focuses the field that comes first', () => {
  vi.useFakeTimers();
  let click: (event: { preventDefault: () => void }) => void = () => {};
  const classes = new Set<string>();
  const focus = vi.fn();
  const checkbox = { focus };
  const form = {
    matches: () => false, scrollIntoView: vi.fn(),
    querySelector: (selector: string) => selector === '[data-next-step-focus]' ? checkbox : null,
    classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
  };
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('document', {
    querySelector: () => ({ hash: '#confirm-terms', addEventListener: (_: string, handler: typeof click) => { click = handler; } }),
    getElementById: (id: string) => id === 'confirm-terms' ? form : null,
    querySelectorAll: () => [],
  });
  setupNextStep();
  const preventDefault = vi.fn();
  click({ preventDefault });
  expect(preventDefault).toHaveBeenCalled();
  expect(form.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(classes.has('next-step-target')).toBe(true);
  vi.advanceTimersByTime(4000);
  expect(classes.has('next-step-target')).toBe(false);
});

it('highlights the whole section for a heading and focuses nothing in it', () => {
  let click: (event: { preventDefault: () => void }) => void = () => {};
  const classes = new Set<string>();
  const section = { scrollIntoView: vi.fn(), classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } };
  const heading = { matches: (selector: string) => selector === 'h2, h3', closest: () => section, querySelector: () => null };
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('document', {
    querySelector: () => ({ hash: '#payment-heading', addEventListener: (_: string, handler: typeof click) => { click = handler; } }),
    getElementById: () => heading,
    querySelectorAll: () => [],
  });
  setupNextStep();
  click({ preventDefault: () => {} });
  expect(section.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  expect(classes.has('next-step-target')).toBe(true);
});
