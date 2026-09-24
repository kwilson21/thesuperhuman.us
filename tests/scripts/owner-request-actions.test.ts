import { afterEach, expect, it, vi } from 'vitest';
import { setupOwnerRequestActions } from '../../src/scripts/owner-request-actions';

afterEach(() => { vi.unstubAllGlobals(); });

it('binds only request status buttons, not project update forms that share data-action', () => {
  const bound: string[] = [];
  const element = (name: string, data: Record<string, string> = {}) => ({ dataset: data, addEventListener: () => { bound.push(name); } });
  const statusButton = element('resolve button', { action: 'resolve' });
  const revisionForm = element('begin_revision form', { action: 'begin_revision' });
  vi.stubGlobal('document', {
    querySelector: (selector: string) => selector === '[data-request-id]' ? { dataset: { requestId: 'song-1' } }
      : selector === '[data-action-status]' ? { textContent: '' } : null,
    querySelectorAll: (selector: string) => selector === '[data-request-actions] button[data-action]' ? [statusButton]
      : selector === '[data-action]' ? [statusButton, revisionForm] : [],
  });
  setupOwnerRequestActions();
  expect(bound).toEqual(['resolve button']);
});

it('asks before resolving a request whose provisional studio is still open', async () => {
  const handlers: Record<string, () => void> = {};
  const button = (action: string, openStudio: boolean) => ({
    dataset: { action },
    closest: (selector: string) => selector === '[data-open-studio]' && openStudio ? {} : null,
    addEventListener: (_: string, handler: () => void) => { handlers[`${action}-${openStudio}`] = handler; },
  });
  const fetch = vi.fn(async () => ({ ok: true }));
  const confirm = vi.fn(() => false);
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('confirm', confirm);
  vi.stubGlobal('location', { reload: () => {} });
  const buttons = [button('resolve', true), button('resolve', false)];
  vi.stubGlobal('document', {
    querySelector: (selector: string) => selector === '[data-request-id]' ? { dataset: { requestId: 'song-1' } }
      : selector === '[data-action-status]' ? { textContent: '' } : null,
    querySelectorAll: () => buttons,
  });
  setupOwnerRequestActions();
  handlers['resolve-true']();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
  handlers['resolve-false']();
  await Promise.resolve();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('reloads a newly reviewed request onto the Accept panel', async () => {
  const handlers: Record<string, () => void> = {};
  const button = { dataset: { action: 'review' }, closest: () => null,
    addEventListener: (_: string, handler: () => void) => { handlers.review = handler; } };
  const replaceState = vi.fn();
  const reload = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
  vi.stubGlobal('history', { replaceState });
  vi.stubGlobal('location', { pathname: '/owner/requests/song-1', search: '', reload });
  vi.stubGlobal('document', {
    querySelector: (selector: string) => selector === '[data-request-id]' ? { dataset: { requestId: 'song-1' } }
      : selector === '[data-action-status]' ? { textContent: '' } : null,
    querySelectorAll: () => [button],
  });
  setupOwnerRequestActions();
  handlers.review();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(replaceState).toHaveBeenCalledWith(null, '', '/owner/requests/song-1#accept-project');
  expect(reload).toHaveBeenCalledOnce();
});
