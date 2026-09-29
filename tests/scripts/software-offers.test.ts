import { afterEach, expect, it, vi } from 'vitest';
import { setupSoftwareOffers } from '~/scripts/software-offers';

// Small DOM stand-in for the two async editor races; actual routes render in page tests.
function fixture() {
  const element = (extra: Record<string, any> = {}) => {
    const events: Record<string, Function> = {};
    return { dataset:{} as Record<string,string>,disabled:false,hidden:false,textContent:'',value:'',checked:false,
      addEventListener:(name:string, handler:Function) => { events[name] = handler; },
      emit:async (name:string, target?:any) => events[name]?.({ preventDefault:vi.fn(), target }),
      querySelector:() => null,querySelectorAll:() => [],setAttribute:vi.fn(),removeAttribute:vi.fn(),...extra };
  };
  const inputs: Record<string, any> = Object.fromEntries(Object.entries({ outcome:'Tracker',summary:'Shared view',clientInputs:'',exclusions:'',timing:'',paymentMode:'standard',hasRange:'',milestoneName:'First',deliverables:'Status view',acceptance:'Add a client',fee:'2400',hasCheckpoint:'' }).map(([name,value]) => [name,element({ value })]));
  const send = element(), preview = element(), status = element(), state = element(), range = element(), checkpoint = element();
  const row = element({ querySelectorAll:(selector:string) => { const input = inputs[selector.match(/name="([^"]+)"/)?.[1] ?? '']; return input ? [input] : []; }, querySelector:(selector:string) => selector === 'legend' ? element() : selector === '[data-checkpoint]' ? checkpoint : inputs[selector.match(/name="([^"]+)"/)?.[1] ?? ''] });
  const list = element({ children:[row],querySelectorAll:(selector:string) => selector === '[data-milestone]' ? [row] : [] });
  const submit = element();
  const form = element({ querySelector:(selector:string) => selector === '[type="submit"]' ? submit : inputs[selector.match(/name="([^"]+)"/)?.[1] ?? ''],querySelectorAll:(selector:string) => { const input = inputs[selector.match(/name="([^"]+)"/)?.[1] ?? '']; return input ? [input] : []; } });
  const targets: Record<string, any> = { '[data-offer-form]':form,'[data-milestones]':list,'[data-software-status]':status,'[data-send-offer]':send,'[data-preview-offer]':preview,'[data-add-milestone]':element(),'[data-range]':range,'[data-copy-link]':element(),'[data-revoke-link]':element(),'[data-offer-state]':state,'[data-link-actions]':element(),'[data-link-state]':element() };
  const versionState = element({ textContent:'sent' }), versionEntry = element({ querySelector:() => versionState });
  targets['[data-offer-versions]'] = element(); targets['[data-version-list]'] = element({ querySelector:() => versionEntry,querySelectorAll:() => [versionState] });
  const root = element({ dataset:{ endpoint:'/api/software',updated:'saved',version:'1',sentVersion:'',revoked:'false',email:'alex@example.com' },querySelector:(selector:string) => targets[selector] });
  vi.stubGlobal('document',{ querySelector:(selector:string) => selector === '[data-offer-form]' ? form : root,querySelectorAll:(selector:string) => selector === '[data-milestone]' ? [row] : [] });
  vi.stubGlobal('sessionStorage',{ getItem:() => null,setItem:vi.fn(),removeItem:vi.fn() });
  vi.stubGlobal('location',{ reload:vi.fn() }); vi.stubGlobal('confirm',vi.fn(() => true));
  setupSoftwareOffers();
  return { root,form,send,preview,status,inputs,targets };
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
  finish(Response.json({ link:'https://thesuperhuman.us/offer/fictional',version:1,updatedAt:'new',emailSent:false,copySent:false })); await pending;
  expect(sessionStorage.setItem).not.toHaveBeenCalled();
  expect(location.reload).not.toHaveBeenCalled();
  expect(root.dataset.busy).toBe('false');
  expect(targets['[data-copy-link]'].hidden).toBe(false);
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
  expect(status.textContent).toBe('Offer v1 is saved as sent. The email service didn’t confirm delivery, so check your inbox for the copy before sending the link yourself.');
});

it('clears radio group invalid state after selection changes', async () => {
  const { form,inputs } = fixture();
  inputs.paymentMode.type = 'radio'; inputs.paymentMode.name = 'paymentMode';
  await form.emit('input',inputs.paymentMode);
  expect(inputs.paymentMode.removeAttribute).toHaveBeenCalledWith('aria-invalid');
});

it('reloads after decline even with unsaved offer edits, removing withdrawn link controls', async () => {
  const { root } = fixture(); root.dataset.dirty = 'true';
  let submit!: (event:any) => Promise<void>;
  const status = { textContent:'' }, button = { disabled:false };
  const form = { dataset:{ softwareAction:'decline', endpoint:'/api/software' },addEventListener:(_name:string, handler:any) => { submit = handler; },querySelector:(selector:string) => selector === 'button' ? button : status };
  vi.stubGlobal('FormData',class { *[Symbol.iterator]() { yield ['text','Thanks.']; } });
  vi.stubGlobal('document',{ querySelector:() => root, querySelectorAll:(selector:string) => selector === '[data-software-action]' ? [form] : [] });
  vi.stubGlobal('fetch',vi.fn(async () => Response.json({ ok:true,copySent:true })));
  setupSoftwareOffers(); await submit({ preventDefault:vi.fn() });
  expect(location.reload).toHaveBeenCalledOnce();
});
