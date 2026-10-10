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

it('shares one renewal check and can renew again after a later expiry', async () => {
  const { start, render } = setup();
  expect(await start()).toBe(true);
  expect(await Promise.all([start(true), start(true)])).toEqual([true, true]);
  expect(render).toHaveBeenCalledTimes(2);
  expect(await start(true)).toBe(true);
  expect(render).toHaveBeenCalledTimes(3);
});
it('keeps a failed renewal disabled for the page view', async () => {
  const { start, render } = setup();
  expect(await start()).toBe(true);
  vi.mocked(fetch).mockRejectedValueOnce(new Error('unavailable'));
  expect(await start(true)).toBe(false);
  expect(await start(true)).toBe(false);
  expect(await start()).toBe(false);
  expect(render).toHaveBeenCalledTimes(2);
});

it('keeps renewal silent when the new check requires interaction', async () => {
  const { start, render, container } = setup();
  expect(await start()).toBe(true);
  render.mockImplementationOnce((_container, options) => {
    queueMicrotask(() => options['before-interactive-callback']());
    return 'renewal-widget';
  });
  expect(await start(true)).toBe(false); expect(await start(true)).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1); expect(render).toHaveBeenCalledTimes(2);
  expect(container.style).toMatchObject({ visibility: 'hidden' });
});
