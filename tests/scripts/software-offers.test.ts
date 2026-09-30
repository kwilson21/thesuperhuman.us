import { afterEach, expect, it, vi } from 'vitest';
import { setupSoftwareOffers } from '~/scripts/software-offers';

// Small DOM stand-in for the two async editor races; actual routes render in page tests.
function fixture(action = 'fit') {
  const element = (extra: Record<string, any> = {}) => {
    const events: Record<string, Function> = {};
    return { dataset:{} as Record<string,string>,disabled:false,hidden:false,textContent:'',value:'',checked:false,
      addEventListener:(name:string, handler:Function) => { events[name] = handler; },
      emit:async function(name:string, target?:any) { return events[name]?.({ preventDefault:vi.fn(), target, currentTarget:this }); },
      querySelector:() => null,querySelectorAll:() => [],setAttribute:vi.fn(),removeAttribute:vi.fn(),...extra };
  };
  const inputs: Record<string, any> = Object.fromEntries(Object.entries({ outcome:'Tracker',summary:'Shared view',clientInputs:'',exclusions:'',timing:'',paymentMode:'standard',hasRange:'',milestoneName:'First',deliverables:'Status view',acceptance:'Add a client',fee:'2400',hasCheckpoint:'' }).map(([name,value]) => [name,element({ value })]));
  const send = element(), preview = element(), status = element(), state = element(), range = element(), checkpoint = element();
  const row: any = element({ querySelectorAll:(selector:string) => { const input = inputs[selector.match(/name="([^"]+)"/)?.[1] ?? '']; return input ? [input] : []; }, querySelector:(selector:string) => selector === 'legend' ? element() : selector === '[data-checkpoint]' ? checkpoint : inputs[selector.match(/name="([^"]+)"/)?.[1] ?? ''] });
  const list: any = element({ children:[row],lastElementChild:row,appendChild:function(child:any) { this.children.push(child); this.lastElementChild = child; },querySelectorAll:function(selector:string) { return selector === '[data-milestone]' ? this.children : []; } });
  const submit = element();
  const form = element({ querySelector:(selector:string) => selector === '[type="submit"]' ? submit : inputs[selector.match(/name="([^"]+)"/)?.[1] ?? ''],querySelectorAll:(selector:string) => { const input = inputs[selector.match(/name="([^"]+)"/)?.[1] ?? '']; return input ? [input] : []; } });
  const targets: Record<string, any> = { '[data-offer-form]':form,'[data-milestones]':list,'[data-software-status]':status,'[data-send-offer]':send,'[data-preview-offer]':preview,'[data-add-milestone]':element(),'[data-range]':range,'[data-copy-link]':element(),'[data-revoke-link]':element({ dataset:{ linkCreatedAt:'displayed-link' } }),'[data-offer-state]':state,'[data-link-actions]':element(),'[data-link-state]':element(),'[data-client-link]':element({ select:vi.fn() }),'[data-client-link-field]':element() };
  targets['[data-milestone-template]'] = { content:{ cloneNode:() => { const first = element({ focus:vi.fn() }); return element({ first,querySelector:(selector:string) => selector === 'input' ? first : row.querySelector(selector) }); } } };
  const versionState = element({ textContent:'sent' }), versionEntry = element({ querySelector:() => versionState });
  targets['[data-offer-versions]'] = element(); targets['[data-version-list]'] = element({ querySelector:() => versionEntry,querySelectorAll:() => [versionState] });
  const actionStatus = element(), siblingForm = element(), privateNote = element();
  const actionButton = element({ textContent:'Send' });
  const actionForm = element({ dataset:{ softwareAction:action, endpoint:'/api/software' }, querySelector:(selector:string) => selector === 'button' ? actionButton : actionStatus });
  const root = element({ dataset:{ endpoint:'/api/software',updated:'saved',version:'1',sentVersion:'',revoked:'false',email:'alex@example.com' },querySelector:(selector:string) => targets[selector] });
  vi.stubGlobal('document',{ querySelector:(selector:string) => selector === '[data-offer-form]' ? form : root,querySelectorAll:(selector:string) => selector === '[data-milestone]' ? [row] : selector === '[data-software-action]' ? [actionForm] : selector === '[data-software-action], [data-request-note], [data-software-editor]' ? [actionForm,siblingForm,privateNote,root] : selector === '[data-software-action], [data-request-note]' ? [actionForm,siblingForm,privateNote] : [] });
  vi.stubGlobal('FormData',class { *[Symbol.iterator]() { yield ['text','Thanks.']; } });
  vi.stubGlobal('sessionStorage',{ getItem:() => null,setItem:vi.fn(),removeItem:vi.fn() });
  vi.stubGlobal('location',{ reload:vi.fn() }); vi.stubGlobal('confirm',vi.fn(() => true));
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  setupSoftwareOffers();
  return { list,actionButton,root,form,send,preview,status,inputs,targets,submit,actionForm,actionStatus,siblingForm,privateNote };
}
afterEach(() => vi.unstubAllGlobals());
it('keeps newer edits unsaved when a draft save finishes', async () => {
  const { form,inputs,send,preview,status } = fixture();
  let finish!: (value:Response) => void;
  vi.stubGlobal('fetch',vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const pending = form.emit('submit');
  inputs.outcome.value = 'A newer title'; await form.emit('input');
  finish(Response.json({ version:1,updatedAt:'new' })); await pending;
  expect(send.disabled).toBe(true); expect(preview.hidden).toBe(true);
  expect(status.textContent).toBe('Draft saved. Your newer edits still need saving.');
});
it('keeps a sent link only in this page view and refreshes versions without reloading', async () => {
  const { root,send,targets } = fixture();
  let finish!: (value:Response) => void;
  vi.stubGlobal('fetch',vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const pending = send.emit('click');
  expect(root.setAttribute).toHaveBeenCalledWith('inert',''); expect(root.dataset.busy).toBe('true');
  finish(Response.json({ link:'https://thesuperhuman.us/offer/fictional',version:1,updatedAt:'new',sentAt:'2026-09-29T12:00:00Z',emailSent:false,copySent:false })); await pending;
  expect(sessionStorage.setItem).not.toHaveBeenCalled();
  expect(location.reload).not.toHaveBeenCalled();
  expect(root.dataset.busy).toBe('false');
  expect(targets['[data-copy-link]'].hidden).toBe(false);
  expect(targets['[data-client-link]'].value).toBe('https://thesuperhuman.us/offer/fictional');
  expect(targets['[data-client-link-field]'].hidden).toBe(false);
  await targets['[data-client-link]'].emit('focus');
  expect(targets['[data-client-link]'].select).toHaveBeenCalledOnce();
  expect(targets['[data-offer-state]'].textContent).toBe('v1 sent Sep 29 · no changes since');
  vi.stubGlobal('navigator', { clipboard:{ writeText:vi.fn().mockRejectedValue(new Error('blocked')) } });
  await targets['[data-copy-link]'].emit('click');
  expect(targets['[data-software-status]'].textContent).toContain('Select and copy the link in the Client link field.');
  expect(targets['[data-offer-versions]'].hidden).toBe(false);
});

it('labels field validation errors and marks inputs until edited', async () => {
  const { form,inputs,status } = fixture();
  vi.stubGlobal('fetch',vi.fn(async () => Response.json({ errors:{ 'milestones.0.feeCents':'The fee must be at least $1.' } },{ status:400 })));
  // The milestone and form use the same field objects in this small DOM fixture.
  const original = inputs.fee.setAttribute;
  await form.emit('submit');
  expect(status.textContent).toBe('Milestone 1 fee: The fee must be at least $1.');
  expect(original).toHaveBeenCalledWith('aria-invalid','true');
  await form.emit('input',inputs.fee);
  expect(inputs.fee.removeAttribute).toHaveBeenCalledWith('aria-invalid');
});
it('reports unconfirmed offer email without claiming rejection', async () => {
  const { send,status } = fixture();
  vi.stubGlobal('fetch',vi.fn(async () => Response.json({ link:'https://example.com/offer/fictional',version:1,updatedAt:'new',emailSent:false,uncertain:true })));
  await send.emit('click');
  expect(status.textContent).toBe('Offer v1 is saved as sent. The email service didn’t confirm delivery. Check Resend before sending the link yourself.');
});

it('clears radio group invalid state after selection changes', async () => {
  const { form,inputs } = fixture();
  inputs.paymentMode.type = 'radio'; inputs.paymentMode.name = 'paymentMode';
  await form.emit('input',inputs.paymentMode);
  expect(inputs.paymentMode.removeAttribute).toHaveBeenCalledWith('aria-invalid');
});

it('reloads after decline with unsaved offer edits only after confirmed discard', async () => {
  const { root } = fixture(); root.dataset.dirty = 'true';
  let submit!: (event:any) => Promise<void>;
  const status = { textContent:'' }, button = { disabled:false };
  const form = { dataset:{ softwareAction:'decline', endpoint:'/api/software' },addEventListener:(_name:string, handler:any) => { submit = handler; },querySelector:(selector:string) => selector === 'button' ? button : status };
  vi.stubGlobal('FormData',class { *[Symbol.iterator]() { yield ['text','Thanks.']; } });
  vi.stubGlobal('document',{ querySelector:() => root, querySelectorAll:(selector:string) => selector === '[data-software-action]' ? [form] : [] });
  vi.stubGlobal('fetch',vi.fn(async () => Response.json({ ok:true,copySent:true })));
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  setupSoftwareOffers(); await submit({ preventDefault:vi.fn() });
  expect(location.reload).toHaveBeenCalledOnce();
});

it('reports confirmed offer email rejection', async () => {
  const { send,status } = fixture();
  vi.stubGlobal('fetch',vi.fn(async () => Response.json({ link:'https://example.com/offer/fictional',version:1,updatedAt:'new',emailSent:false,uncertain:false })));
  await send.emit('click');
  expect(status.textContent).toBe('Offer v1 is saved as sent, but the email didn’t go out. Copy the link and send it yourself.');
});

it('keeps revoke working when the resolved editor form is absent', async () => {
  const { root,targets } = fixture();
  delete targets['[data-offer-form]'];
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  setupSoftwareOffers();
  vi.stubGlobal('fetch',vi.fn(async () => Response.json({ ok:true })));
  await targets['[data-revoke-link]'].emit('click');
  expect(fetch).toHaveBeenCalledWith(root.dataset.endpoint,expect.objectContaining({ body:JSON.stringify({ action:'revoke', expectedLinkCreatedAt:'displayed-link' }) }));
  expect(location.reload).toHaveBeenCalledOnce();
});

it('keeps on-screen edits and retries a conflicted save with the returned timestamp', async () => {
  const { root, form, inputs, status } = fixture();
  inputs.outcome.value = 'Newer edits'; await form.emit('input');
  const message = 'The saved draft changed since this page loaded. Save again to keep what’s on screen, or reload to see the saved version.';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ updatedAt:'current', message }, { status:409 })).mockResolvedValueOnce(Response.json({ version:1, updatedAt:'next' })));
  await form.emit('submit');
  expect(status.textContent).toBe(message); expect(inputs.outcome.value).toBe('Newer edits'); expect(root.dataset.dirty).toBe('true');
  await form.emit('submit');
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({ expectedUpdatedAt:'current', terms:{ outcome:'Newer edits' } });
  expect(root.dataset.dirty).toBe('false');
});
it.each([true, false])('locks all request actions during send and restores them (success %s)', async success => {
  const { root, send } = fixture();
  let finish!: (value:Response) => void;
  vi.stubGlobal('fetch',vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const pending = send.emit('click');
  expect(root.dataset.offerSending).toBe('true');
  finish(success ? Response.json({ link:'https://example.com/offer/test', version:1, updatedAt:'new', emailSent:true }) : Response.json({ message:'Failed' }, { status:500 }));
  await pending;
  expect(root.dataset.offerSending).toBe('false'); expect(root.removeAttribute).toHaveBeenCalledWith('inert');
});
it('prompts before unloading only while offer edits are dirty', async () => {
  const { form } = fixture();
  const handler = vi.mocked(window.addEventListener).mock.calls[0][1] as (event:any) => void;
  const event = { preventDefault:vi.fn(), returnValue:undefined };
  handler(event); expect(event.preventDefault).not.toHaveBeenCalled();
  await form.emit('input'); handler(event); expect(event.preventDefault).toHaveBeenCalledOnce();
});

it.each([401,403,500])('preserves editor contents and restores controls for non-JSON status %s', async code => {
  for (const action of ['draft','send','revoke']) {
    const { root,form,send,inputs,status,targets,submit } = fixture();
    vi.stubGlobal('fetch',vi.fn(async () => new Response('Owner access required.', { status:code })));
    inputs.outcome.value = 'Keep this title';
    if (action === 'draft') await form.emit('submit');
    if (action === 'send') await send.emit('click');
    if (action === 'revoke') await targets['[data-revoke-link]'].emit('click');
    expect(status.textContent).toBe(code === 500 ? 'Something went wrong. Nothing was saved. Try again.' : 'Your owner session ended. Reload the page to sign in again.');
    expect(inputs.outcome.value).toBe('Keep this title');
    expect(submit.disabled).toBe(false); expect(send.disabled).toBe(false); expect(targets['[data-revoke-link]'].disabled).toBe(false);
    expect(root.dataset.busy).not.toBe('true'); expect(location.reload).not.toHaveBeenCalled();
  }
});
it.each(['fit','question','decline'])('keeps %s form contents and restores its button on a non-JSON session failure', async action => {
  const { root } = fixture();
  let submit!: (event:any) => Promise<void>;
  const status = { textContent:'' }, button = { disabled:false }, input = { value:'Keep my message' };
  const form = { dataset:{ softwareAction:action, endpoint:'/api/software' },addEventListener:(_name:string, handler:any) => { submit = handler; },querySelector:(selector:string) => selector === 'button' ? button : status };
  vi.stubGlobal('FormData',class { *[Symbol.iterator]() { yield ['text',input.value]; } });
  vi.stubGlobal('document',{ querySelector:() => root, querySelectorAll:(selector:string) => selector === '[data-software-action]' ? [form] : [] });
  vi.stubGlobal('fetch',vi.fn(async () => new Response('Owner access required.', { status:403 })));
  setupSoftwareOffers(); await submit({ preventDefault:vi.fn() });
  expect(status.textContent).toBe('Your owner session ended. Reload the page to sign in again.');
  expect(input.value).toBe('Keep my message'); expect(button.disabled).toBe(false); expect(location.reload).not.toHaveBeenCalled();
});

it.each(['fit','question','decline','revoke'])('keeps sibling text on canceled reload after %s', async action => {
  const { actionForm,actionStatus,privateNote,targets,status } = fixture(action);
  await privateNote.emit('input');
  vi.mocked(confirm).mockImplementation(message => message !== 'You have unsaved changes in another section. Continue and lose them?');
  vi.stubGlobal('fetch',vi.fn(async () => Response.json({ ok:true, updatedAt:'new',copySent:true })));
  if (action === 'revoke') await targets['[data-revoke-link]'].emit('click'); else await actionForm.emit('submit');
  expect(confirm).toHaveBeenCalledWith('You have unsaved changes in another section. Continue and lose them?');
  expect(location.reload).not.toHaveBeenCalled();
  expect(action === 'revoke' ? status.textContent : actionStatus.textContent).toBe(action === 'revoke' ? 'Client link revoked.' : action === 'fit' ? 'Fit review saved.' : 'Sent.');
});
it('tracks the other software forms and permits confirmed discard', async () => {
  const { actionForm,siblingForm } = fixture();
  await siblingForm.emit('input');
  vi.stubGlobal('fetch',vi.fn(async () => Response.json({ ok:true,updatedAt:'new' })));
  await actionForm.emit('submit');
  expect(confirm).toHaveBeenCalledWith('You have unsaved changes in another section. Continue and lose them?');
  expect(location.reload).toHaveBeenCalledOnce();
});
it('sending retains unsaved sibling forms without reloading', async () => {
  const { siblingForm,send } = fixture(); await siblingForm.emit('input');
  vi.stubGlobal('fetch',vi.fn(async () => Response.json({ link:'https://example.com/offer/test',version:1,updatedAt:'new',emailSent:true })));
  await send.emit('click');
  expect(siblingForm.dataset.dirty).toBe('true'); expect(location.reload).not.toHaveBeenCalled();
});
it('does not prompt on unload after a generic action marks the shared page clean', async () => {
  const { markRequestPageClean } = await import('~/scripts/software-offers');
  const { form,siblingForm } = fixture();
  await form.emit('input'); await siblingForm.emit('input');
  const handler = vi.mocked(window.addEventListener).mock.calls[0][1] as (event:any) => void;
  const event = { preventDefault:vi.fn() };
  handler(event); expect(event.preventDefault).toHaveBeenCalledOnce();
  markRequestPageClean(); event.preventDefault.mockClear();
  handler(event); expect(event.preventDefault).not.toHaveBeenCalled();
});

it('revokes the link returned by an in-page send', async () => {
  const { send,targets } = fixture();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({ link:'https://example.com/offer/test',linkCreatedAt:'replacement-link',version:1,updatedAt:'new',emailSent:true })).mockResolvedValueOnce(Response.json({ ok:true })));
  await send.emit('click');
  await targets['[data-revoke-link]'].emit('click');
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({ action:'revoke',expectedLinkCreatedAt:'replacement-link' });
});

it('updates revoked controls before a canceled reload and permits reissue', async () => {
  const { send,root,targets,privateNote } = fixture();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({ link:'https://example.com/offer/test',linkCreatedAt:'replacement',version:1,updatedAt:'sent',emailSent:true })).mockResolvedValueOnce(Response.json({ ok:true })));
  await send.emit('click'); await privateNote.emit('input');
  vi.mocked(confirm).mockImplementation(message => message !== 'You have unsaved changes in another section. Continue and lose them?');
  await targets['[data-revoke-link]'].emit('click');
  expect(location.reload).not.toHaveBeenCalled(); expect(root.dataset.revoked).toBe('true');
  expect(targets['[data-link-state]'].textContent).toBe('Client link revoked.');
  expect(targets['[data-client-link]'].value).toBe(''); expect(targets['[data-client-link-field]'].hidden).toBe(true);
  expect(targets['[data-revoke-link]'].disabled).toBe(true); expect(targets['[data-revoke-link]'].hidden).toBe(true);
  expect(send.disabled).toBe(false);
  vi.stubGlobal('fetch',vi.fn(async () => Response.json({ link:'https://example.com/offer/reissued',version:1,updatedAt:'reissued',emailSent:true })));
  await send.emit('click'); expect(targets['[data-revoke-link]'].hidden).toBe(false); expect(targets['[data-revoke-link]'].disabled).toBe(false);
});
it.each(['question','decline'])('requires an explicit retry after a lost %s response', async action => {
  const { actionForm,actionStatus,actionButton } = fixture(action);
  await actionForm.emit('input');
  vi.stubGlobal('fetch',vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(Response.json({ ok:true,copySent:true })));
  await actionForm.emit('submit');
  expect(actionStatus.textContent).toBe('The request didn’t finish. Check the activity log or Resend before sending again.');
  expect(actionButton.textContent).toBe('Send again'); expect(actionButton.disabled).toBe(false);
  expect(actionForm.dataset.dirty).toBe('true'); expect(fetch).toHaveBeenCalledOnce(); expect(location.reload).not.toHaveBeenCalled();
  await actionForm.emit('submit');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).text).toBe('Thanks.');
});
it('focuses and announces each added milestone, including the third', async () => {
  const { list,targets,status } = fixture();
  for (const count of [2,3]) {
    await targets['[data-add-milestone]'].emit('click');
    expect(list.children).toHaveLength(count); expect(list.lastElementChild.first.focus).toHaveBeenCalledOnce();
    expect(status.textContent).toBe(`Milestone ${count} added.`);
  }
  expect(targets['[data-add-milestone]'].disabled).toBe(true);
});
