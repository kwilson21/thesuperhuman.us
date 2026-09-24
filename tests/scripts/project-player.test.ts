import { afterEach, expect, it, vi } from 'vitest';
import { setupProjectPlayers } from '../../src/scripts/project-player';

afterEach(() => { vi.unstubAllGlobals(); });

function element(extra: Record<string, unknown> = {}) {
  const handlers: Record<string, Array<(event?: unknown) => void>> = {};
  const attributes: Record<string, string> = {};
  return {
    handlers, disabled: false, hidden: true, textContent: '', value: '0', style: { setProperty: vi.fn() },
    classList: { classes: new Set<string>(), add(name: string) { this.classes.add(name); }, remove(name: string) { this.classes.delete(name); } },
    addEventListener(type: string, handler: (event?: unknown) => void) { (handlers[type] ??= []).push(handler); },
    getAttribute: (name: string) => attributes[name] ?? null,
    setAttribute: (name: string, value: string) => { attributes[name] = value; },
    fire(type: string) { for (const handler of handlers[type] ?? []) handler(); },
    ...extra,
  };
}

it('shows an accessible problem and disables the controls when the audio cannot load or play, then retries', async () => {
  const load = vi.fn();
  const audio = element({ paused: true, duration: NaN, currentTime: 0, load, pause: vi.fn(),
    play: vi.fn(async () => { throw Object.assign(new Error('Not found'), { name: 'NotSupportedError' }); }) });
  const toggle = element();
  toggle.setAttribute('aria-label', 'Play Review');
  const seek = element(), time = element(), wave = element(), problem = element(), status = element(), retry = element();
  const parts: Record<string, unknown> = { audio, '[data-player-toggle]': toggle, '[data-player-seek]': seek, '[data-player-time]': time,
    '.player-wave': wave, '[data-player-problem]': problem, '[data-player-status]': status, '[data-player-retry]': retry };
  const player = element({ querySelector: (selector: string) => parts[selector] ?? null });
  vi.stubGlobal('document', { querySelectorAll: () => [player] });
  setupProjectPlayers();

  toggle.fire('click');
  await Promise.resolve(); await Promise.resolve();
  expect(toggle.disabled).toBe(true);
  expect(seek.disabled).toBe(true);
  expect(problem.hidden).toBe(false);
  expect(status.textContent).toContain('could not load');
  expect(player.classList.classes.has('unavailable')).toBe(true);

  retry.fire('click');
  expect(load).toHaveBeenCalledOnce();
  expect(toggle.disabled).toBe(false);
  expect(problem.hidden).toBe(true);

  audio.fire('error');
  expect(toggle.disabled).toBe(true);
  expect(status.textContent).toContain('could not load');
});
