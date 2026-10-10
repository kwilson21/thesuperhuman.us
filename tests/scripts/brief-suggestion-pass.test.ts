import { afterEach, expect, it, vi } from 'vitest';
import { setupSuggestionPass } from '~/scripts/brief-suggestion-pass';
afterEach(() => vi.unstubAllGlobals());
function setup(interactive = false) {
  const container = { style: {}, setAttribute: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('document', { createElement: () => container, body: { appendChild: vi.fn() } });
  const render = vi.fn((_container, options) => {
    queueMicrotask(() => {
      if (interactive) options['before-interactive-callback']();
      options.callback('token');
    });
    return 'widget';
  });
  const remove = vi.fn();
  vi.stubGlobal('window', { turnstile: { ready: (callback: () => void) => callback(), render, remove } });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })));
  return { container, render, remove, start: setupSuggestionPass({ dataset: { suggestionSitekey: 'site-key' } } as any) };
}
it('verifies silently once and keeps the submission token field separate', async () => {
  const { start, container, render } = setup();
  expect(await start()).toBe(true); expect(await start()).toBe(true);
  expect(render).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1);
  expect(container.style).toMatchObject({ visibility: 'hidden', position: 'fixed' });
  expect(render.mock.calls[0][1]).toMatchObject({ appearance: 'interaction-only', 'response-field': false });
});
it('never shows an interactive challenge or requests a pass afterward', async () => {
  const { start, container, remove } = setup(true);
  expect(await start()).toBe(false); expect(fetch).not.toHaveBeenCalled();
  expect(container.style).toMatchObject({ visibility: 'hidden' });
  expect(container.remove).toHaveBeenCalled(); expect(remove).toHaveBeenCalledWith('widget');
});
it('disables suggestions without a configured widget', async () => {
  expect(await setupSuggestionPass({ dataset: {} } as any)()).toBe(false);
});
