import { afterEach, expect, it, vi } from 'vitest';
import { setupSoftwareOffers } from '~/scripts/software-offers';

// Small DOM stand-in for the two async editor races; actual routes render in page tests.
function fixture() {
  const element = (extra: Record<string, any> = {}) => {
    const events: Record<string, Function> = {};
    return { dataset:{} as Record<string,string>,disabled:false,hidden:false,textContent:'',value:'',checked:false,
      addEventListener:(name:string, handler:Function) => { events[name] = handler; },
      emit:async (name:string) => events[name]?.({ preventDefault:vi.fn() }),
      querySelector:() => null,querySelectorAll:() => [],setAttribute:vi.fn(),removeAttribute:vi.fn(),...extra };
  };
  const inputs: Record<string, any> = Object.fromEntries(Object.entries({ outcome:'Tracker',summary:'Shared view',clientInputs:'',exclusions:'',timing:'',paymentMode:'standard',hasRange:'',milestoneName:'First',deliverables:'Status view',acceptance:'Add a client',fee:'2400',hasCheckpoint:'' }).map(([name,value]) => [name,element({ value })]));
  const send = element(), preview = element(), status = element(), state = element(), range = element(), checkpoint = element();
  const row = element({ querySelector:(selector:string) => selector === '[data-checkpoint]' ? checkpoint : inputs[selector.match(/name="([^"]+)"/)?.[1] ?? ''] });
  const list = element({ children:[row],querySelectorAll:(selector:string) => selector === '[data-milestone]' ? [row] : [] });
  const submit = element();
  const form = element({ querySelector:(selector:string) => selector === '[type="submit"]' ? submit : inputs[selector.match(/name="([^"]+)"/)?.[1] ?? ''] });
  const targets: Record<string, any> = { '[data-offer-form]':form,'[data-milestones]':list,'[data-software-status]':status,'[data-send-offer]':send,'[data-preview-offer]':preview,'[data-add-milestone]':element(),'[data-range]':range,'[data-copy-link]':element(),'[data-revoke-link]':element(),'[data-offer-state]':state,'[data-link-actions]':element(),'[data-link-state]':element() };
  const root = element({ dataset:{ endpoint:'/api/software',updated:'saved',version:'1',sentVersion:'',revoked:'false',email:'alex@example.com' },querySelector:(selector:string) => targets[selector] });
  vi.stubGlobal('document',{ querySelector:() => root,querySelectorAll:() => [] });
  vi.stubGlobal('sessionStorage',{ getItem:() => null,setItem:vi.fn(),removeItem:vi.fn() });
  vi.stubGlobal('location',{ reload:vi.fn() }); vi.stubGlobal('confirm',vi.fn(() => true));
  setupSoftwareOffers();
  return { root,form,send,preview,status,inputs };
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
it('makes the editor inert throughout send and refreshes history with a preserved result', async () => {
  const { root,send } = fixture();
  let finish!: (value:Response) => void;
  vi.stubGlobal('fetch',vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const pending = send.emit('click');
  expect(root.setAttribute).toHaveBeenCalledWith('inert',''); expect(root.dataset.busy).toBe('true');
  finish(Response.json({ link:'https://thesuperhuman.us/offer/fictional',version:1,updatedAt:'new',emailSent:false,copySent:false })); await pending;
  expect(sessionStorage.setItem).toHaveBeenCalledWith('software-flash:/api/software', expect.stringContaining('email didn’t go out'));
  expect(location.reload).toHaveBeenCalledOnce();
});
