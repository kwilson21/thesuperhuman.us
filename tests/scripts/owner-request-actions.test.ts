import { afterEach, expect, it, vi } from 'vitest';
import { setupOwnerRequestActions } from '../../src/scripts/owner-request-actions';

afterEach(() => { vi.unstubAllGlobals(); });

it('binds only request status buttons, not project update forms that share data-action', () => {
  const bound: string[] = [];
  const element = (name: string, data: Record<string, string> = {}) => ({ dataset: data, addEventListener: () => { bound.push(name); } });
  const statusButton = element('resolve button', { action: 'resolve' });
  const revisionForm = element('begin_revision form', { action: 'begin_revision' });
  vi.stubGlobal('location', { hash: '' });
  vi.stubGlobal('document', {
    querySelector: (selector: string) => selector === '[data-request-id]' ? { dataset: { requestId: 'song-1' }, querySelector: () => null }
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
    querySelector: (selector: string) => selector === '[data-request-id]' ? { dataset: { requestId: 'song-1' }, querySelector: () => null }
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
    querySelector: (selector: string) => selector === '[data-request-id]' ? { dataset: { requestId: 'song-1' }, querySelector: () => null }
      : selector === '[data-action-status]' ? { textContent: '' } : null,
    querySelectorAll: () => [button],
  });
  setupOwnerRequestActions();
  handlers.review();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(replaceState).toHaveBeenCalledWith(null, '', '/owner/requests/song-1#accept-project');
  // The reload must not restore the old scroll position over the Accept panel.
  expect(history.scrollRestoration).toBe('manual');
  expect(reload).toHaveBeenCalledOnce();
});

it('scrolls to the Accept panel on the reloaded page and clears the fragment', () => {
  const scrollIntoView = vi.fn();
  const focus = vi.fn();
  const replaceState = vi.fn();
  const accept = { scrollIntoView, querySelector: () => ({ focus }) };
  vi.stubGlobal('history', { replaceState });
  vi.stubGlobal('location', { pathname: '/owner/requests/song-1', search: '', hash: '#accept-project', reload: vi.fn() });
  vi.stubGlobal('document', {
    getElementById: (id: string) => id === 'accept-project' ? accept : null,
    querySelector: (selector: string) => selector === '[data-request-id]' ? { dataset: { requestId: 'song-1' }, querySelector: () => null }
      : selector === '[data-action-status]' ? { textContent: '' } : null,
    querySelectorAll: () => [],
  });
  setupOwnerRequestActions();
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(replaceState).toHaveBeenCalledWith(null, '', '/owner/requests/song-1');
  expect(history.scrollRestoration).toBe('auto');
});

it.each(['note','review','resolve','reopen','withdraw'])('confirms dirty offer edits before %s and sends the shared timestamp', async action => {
  let handler!: (event:any) => void;
  const button = { dataset:{ action }, closest:() => null, addEventListener:(_:string,fn:any) => { handler=fn; } };
  const note = { dataset:{ dirty:'true' }, addEventListener:(_:string,fn:any) => { if(action === 'note') handler=fn; } };
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({ ok:true }));
  vi.stubGlobal('fetch',fetch); vi.stubGlobal('confirm',vi.fn((message: string) => message === 'Honor this withdrawal and close the request?'));
  vi.stubGlobal('location',{ hash:'',pathname:'/owner/requests/r',search:'',reload:vi.fn() }); vi.stubGlobal('history',{ replaceState:vi.fn() });
  vi.stubGlobal('FormData',class { get() { return 'Note'; } });
  vi.stubGlobal('document',{
    querySelector:(selector:string) => selector === '[data-request-id]' ? { dataset:{ requestId:'r',requestUpdated:'fit-saved' },querySelector:() => ({ dataset:{ dirty:'true' } }) } : selector === '[data-action-status]' ? { textContent:'' } : note,
    querySelectorAll:(selector:string) => selector === '[data-request-actions] button[data-action]' ? (action === 'note' ? [] : [button]) : [{ dataset:{ dirty:'true' } },note],
  });
  setupOwnerRequestActions();
  handler({ preventDefault:vi.fn(),currentTarget:note });
  await Promise.resolve(); expect(fetch).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledWith('You have unsaved changes in another section. Continue and lose them?');
  vi.mocked(confirm).mockReturnValue(true);
  handler({ preventDefault:vi.fn(),currentTarget:note }); await Promise.resolve();
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ action,expectedUpdatedAt:'fit-saved' });
});

it.each(['offer','fit','question','decline','private-note'])('checks dirty %s before posting and clears all sections before reload', async section => {
  let click!: () => void;
  const button = { dataset:{ action:'reopen' },closest:() => null,addEventListener:(_:string,fn:any) => { click = fn; } };
  const dirty = { dataset:{ dirty:'true',section } };
  const fetch = vi.fn(async () => ({ ok:true }));
  const reload = vi.fn(() => { expect(dirty.dataset.dirty).toBe('false'); });
  vi.stubGlobal('fetch',fetch); vi.stubGlobal('confirm',vi.fn(() => false));
  vi.stubGlobal('location',{ hash:'',reload });
  vi.stubGlobal('document',{
    querySelector:(selector:string) => selector === '[data-request-id]' ? { dataset:{ requestId:'r' } } : selector === '[data-action-status]' ? { textContent:'' } : null,
    querySelectorAll:(selector:string) => selector === '[data-request-actions] button[data-action]' ? [button] : [dirty],
  });
  setupOwnerRequestActions(); click(); expect(fetch).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledWith('You have unsaved changes in another section. Continue and lose them?');
  vi.mocked(confirm).mockReturnValue(true); click(); await Promise.resolve();
  expect(fetch).toHaveBeenCalledOnce(); expect(reload).toHaveBeenCalledOnce();
});

it.each([true,false])('saves its own private note without a discard prompt (software %s)', async software => {
  let submit!: (event:any) => void;
  const note = { dataset:{ dirty:'true' },addEventListener:(_:string,fn:any) => { submit=fn; } };
  vi.stubGlobal('fetch',vi.fn(async () => ({ ok:true }))); vi.stubGlobal('confirm',vi.fn());
  vi.stubGlobal('location',{ hash:'',reload:vi.fn() });
  vi.stubGlobal('FormData',class { get() { return 'Note'; } });
  vi.stubGlobal('document',{
    querySelector:(selector:string) => selector === '[data-request-id]' ? { dataset:{ requestId:'r' } } : selector === '[data-action-status]' ? { textContent:'' } : note,
    querySelectorAll:(selector:string) => selector === '[data-request-actions] button[data-action]' ? [] : software ? [note] : [],
  });
  setupOwnerRequestActions(); submit({ preventDefault:vi.fn(),currentTarget:note }); await Promise.resolve();
  expect(confirm).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce(); expect(location.reload).toHaveBeenCalledOnce();
});
