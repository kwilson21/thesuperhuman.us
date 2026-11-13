import { afterEach, expect, it, vi } from 'vitest';
import { setupPinnedContact } from '../../src/scripts/pinned-contact';

afterEach(() => { vi.unstubAllGlobals(); });

type Observer = { callback: (entries: { isIntersecting: boolean }[]) => void; observed: unknown };

// A plain element with attributes, enough for the script's hidden and data-at-end handling.
const element = (initial: Record<string, string> = {}) => {
  const attributes = new Map(Object.entries(initial));
  return {
    attributes,
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    removeAttribute: (name: string) => { attributes.delete(name); },
  };
};

const stubPage = (elements: Record<string, unknown>) => {
  vi.stubGlobal('document', { querySelector: (selector: string) => elements[selector] ?? null });
};

const stubObserver = () => {
  const observers: Observer[] = [];
  class FakeObserver {
    callback: Observer['callback'];
    observed: unknown = null;
    constructor(callback: Observer['callback']) {
      this.callback = callback;
      observers.push(this as unknown as Observer);
    }
    observe(target: unknown) { this.observed = target; }
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  return observers;
};

it('shows the pinned button and marks it at the end while the closing panel is on screen', () => {
  const pinned = element({ hidden: '' });
  const panel = element();
  stubPage({ '[data-pinned-contact]': pinned, '.closing-panel': panel });
  const observers = stubObserver();
  setupPinnedContact();
  expect(pinned.hasAttribute('hidden')).toBe(false);
  expect(observers).toHaveLength(1);
  expect(observers[0].observed).toBe(panel);
  observers[0].callback([{ isIntersecting: true }]);
  expect(pinned.hasAttribute('data-at-end')).toBe(true);
  observers[0].callback([{ isIntersecting: false }]);
  expect(pinned.hasAttribute('data-at-end')).toBe(false);
});

it('stays hidden when there is no closing panel', () => {
  const pinned = element({ hidden: '' });
  stubPage({ '[data-pinned-contact]': pinned });
  const observers = stubObserver();
  setupPinnedContact();
  expect(pinned.hasAttribute('hidden')).toBe(true);
  expect(observers).toHaveLength(0);
});

it('stays hidden when IntersectionObserver is not available', () => {
  const pinned = element({ hidden: '' });
  stubPage({ '[data-pinned-contact]': pinned, '.closing-panel': element() });
  vi.stubGlobal('IntersectionObserver', undefined);
  setupPinnedContact();
  expect(pinned.hasAttribute('hidden')).toBe(true);
});
