import { afterEach, expect, it, vi } from 'vitest';
import { setupSoftwareProject } from '../../src/scripts/software-project';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('rechecks the New York start date before validating and submitting', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T03:59:59Z'));
  const date = { required: true, disabled: false };
  const agreement = { required: true, disabled: false };
  const inputs = { checked: true };
  const block = { hidden: false, querySelectorAll: () => [date, agreement] };
  const button = { disabled: false };
  const listeners: Record<string, (event: Event) => void> = {};
  const form = {
    noValidate: false, dataset: { plannedStart: '2026-10-01', requestUpdatedAt: 'saved' },
    querySelector: (selector: string) => selector === '[data-earlier-start]' ? block : selector === 'button' ? button : { checked: true },
    addEventListener: (type: string, callback: (event: Event) => void) => { listeners[type] = callback; },
    reportValidity: vi.fn(() => !date.required && !agreement.required && inputs.checked),
  };
  const root = {
    dataset: { endpoint: '/start' },
    querySelector: (selector: string) => selector === '[data-software-start]' ? form : selector === '[data-software-status]' ? { textContent: '' } : null,
    querySelectorAll: (selector: string) => selector === 'button' ? [button] : [],
  };
  vi.stubGlobal('document', { querySelectorAll: () => [root] });
  vi.stubGlobal('FormData', class { get(name: string) { return name === 'offer_version' ? '1' : null; } has() { return true; } });
  const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Test response' }) });
  vi.stubGlobal('fetch', fetch);
  setupSoftwareProject();
  expect(form.noValidate).toBe(true);
  listeners.submit(new Event('submit', { cancelable: true }));
  expect(date.required).toBe(true);
  expect(block.hidden).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  vi.setSystemTime(new Date('2026-10-01T04:00:00Z'));
  inputs.checked = false;
  listeners.submit(new Event('submit', { cancelable: true }));
  expect(date.required).toBe(false);
  expect(agreement.required).toBe(false);
  expect(date.disabled).toBe(true);
  expect(block.hidden).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
  inputs.checked = true;
  listeners.submit(new Event('submit', { cancelable: true }));
  expect(fetch).toHaveBeenCalledOnce();
  expect(form.reportValidity).toHaveBeenCalledTimes(3);
});
