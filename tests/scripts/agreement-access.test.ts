import { afterEach, expect, it, vi } from "vitest";
import { setupAgreementAccess } from "~/scripts/agreement-access";
import { consentText } from "~/lib/agreement-fields";
function fixture() {
  const values: Record<string, string> = {
    legal_name: " Example LLC ",
    signer_name: " Alex Example ",
    signer_title: " Owner ",
    entity_type: "",
    state: "",
    country: "",
    business_address: "",
    portfolio_choice: "",
    reviewer_name: "",
    reviewer_email: "",
    approver_name: "",
    approver_email: "",
    notice_email: "",
    csrf_nonce: "csrf",
    documents: "[]",
  };
  const node = (extra: Record<string, unknown> = {}) => {
    const events: Record<string, Function> = {};
    return {
      value: "",
      textContent: "",
      hidden: false,
      checked: false,
      disabled: false,
      dataset: {},
      addEventListener: (event: string, fn: Function) => {
        events[event] = fn;
      },
      emit: async (event: string) =>
        events[event]?.({ preventDefault: vi.fn(), stopPropagation: vi.fn() }),
      replaceChildren: vi.fn(),
      appendChild: vi.fn(),
      querySelector: () => null,
      querySelectorAll: () => [],
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      focus: vi.fn(),
      ...extra,
    };
  };
  const elements: Record<string, ReturnType<typeof node>> = {};
  for (const selector of [
    '[name="csrf_nonce"]',
    '[role="status"]',
    '[name="documents"]',
    "[data-sign-button]",
    "[data-signature-name]",
    "[data-signature-details]",
    "[data-consent-text]",
    '[name="country"]',
    '[name="consent"]',
    "[data-fresh-link]",
    "[data-agreed-terms]",
    "[data-reviewed-documents]",
    "[data-review-hint]",
    "[data-consent-updated]",
  ])
    elements[selector] = node();
  Object.defineProperty(elements['[name="country"]'], 'value', {get:()=>values.country,set:(value:string)=>{values.country=value;}});
  elements['[name="csrf_nonce"]'].value = "csrf";
  const form = node({
    dataset: { token: "offer", email: "alex@example.com" },
    querySelector: (s: string) => elements[s] ?? null,
  });
  const summary = node();
  vi.stubGlobal("document", {
    querySelector: (selector: string) =>
      selector === "[data-signing-page]" ? form : summary,
    querySelectorAll: () => [],
    createElement: () => node(),
    getElementById: () => null,
  });
  vi.stubGlobal(
    "FormData",
    class {
      constructor(_form: unknown) {}
      *[Symbol.iterator]() {
        yield* Object.entries(values);
      }
      has(key: string) {
        return key in values;
      }
      get(key: string) {
        return values[key] ?? null;
      }
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ok: true })),
  );
  return { values, elements, form };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("shows the normalized name and exactly the consent text retained by the server", async () => {
  const { elements } = fixture();
  setupAgreementAccess();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(elements["[data-signature-name]"].textContent).toBe("Alex Example");
  expect(elements["[data-signature-details]"].textContent).toBe(
    "Alex Example · Owner, Example LLC",
  );
  expect(elements["[data-consent-text]"].textContent).toBe(
    consentText("Example LLC"),
  );
  expect(fetch).toHaveBeenCalledOnce();
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/draft");
});
it("autosaves changed fields and clears consent before a new review", async () => {
  vi.useFakeTimers();
  const { elements, form, values } = fixture();
  setupAgreementAccess();
  await vi.runAllTimersAsync();
  elements['[name="consent"]'].checked = true;
  values.signer_title = "Director";
  await form.emit("input");
  expect(elements['[name="consent"]'].checked).toBe(false);
  await vi.runAllTimersAsync();
  const body = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]?.body));
  expect(body.values.signer_title).toBe("Director");
});

it('document links activate the existing reader navigation',()=>{
  let click: Function;
  const stageClick=vi.fn(), scroll=vi.fn();
  const reader={open:false,querySelector:(selector:string)=>{expect(selector).toBe('[data-terms-stage-button="3"]');return {click:stageClick};}};
  const link={hash:'#review-sow',hasAttribute:()=>true,addEventListener:(_event:string,handler:Function)=>{click=handler;}};
  vi.stubGlobal('document',{
    querySelectorAll:(selector:string)=>selector.includes('[data-document-link]')?[link]:[],
    querySelector:(selector:string)=>selector==='#review-sow'?{scrollIntoView:scroll}:selector==='[data-agreed-terms]'?reader:null,
  });
  setupAgreementAccess();
  const preventDefault=vi.fn();click!({preventDefault});
  expect(reader.open).toBe(true);expect(stageClick).toHaveBeenCalledOnce();expect(scroll).toHaveBeenCalledOnce();expect(preventDefault).toHaveBeenCalledOnce();
});

it.each(['Wyoming','District of Columbia'])('prefills an empty country for %s and preserves edits',async state=>{
  vi.useFakeTimers();
  const {values,form}=fixture();values.state=state;
  setupAgreementAccess();expect(values.country).toBe('United States');
  values.country='Canada';await form.emit('input');expect(values.country).toBe('Canada');
  await vi.runAllTimersAsync();

 });
it.each(['','Outside the US','Unknown'])('leaves an empty country for %s',state=>{
  const {values}=fixture();values.state=state;setupAgreementAccess();expect(values.country).toBe('');
 });

it('renders only the saved-details confirmation after refreshing review documents',async()=>{
  const {values,elements}=fixture();
  Object.assign(values,{entity_type:'LLC',state:'Wyoming',business_address:'Example business address',portfolio_choice:'private'});
  vi.mocked(fetch).mockImplementation(async()=>Response.json({documents:[{id:'sow',kind:'sow',hash:'a'.repeat(64),text:'Exact SOW'}]}));
  setupAgreementAccess();
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(elements['[role="status"]'].textContent).toBe('Details saved.');
  expect(elements['[data-reviewed-documents]'].appendChild).toHaveBeenCalledOnce();
});

it.each(['United States','Canada'])('clears only the US default when switching outside the US (%s)',async country=>{
  vi.useFakeTimers();
  const {values,form}=fixture();values.state='Wyoming';
  setupAgreementAccess();values.country=country;values.state='Outside the US';
  await form.emit('input');
  expect(values.country).toBe(country==='United States'?'':country);
  await vi.runAllTimersAsync();
});

it('opening reviewed terms preserves the documents and consent',async()=>{
  const {values,elements}=fixture();
  Object.assign(values,{entity_type:'LLC',state:'Wyoming',business_address:'Example business address',portfolio_choice:'private'});
  vi.mocked(fetch).mockImplementation(async()=>Response.json({documents:[{id:'sow',kind:'sow',hash:'a'.repeat(64),text:'Exact SOW'}]}));
  setupAgreementAccess();await new Promise(resolve=>setTimeout(resolve,0));
  const calls=vi.mocked(fetch).mock.calls.length;
  elements['[name="consent"]'].checked=true;
  Object.assign(elements['[data-agreed-terms]'],{open:true});
  await elements['[data-agreed-terms]'].emit('toggle');
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(fetch).toHaveBeenCalledTimes(calls);
  expect(elements['[name="consent"]'].checked).toBe(true);
});
it('refreshing documents clears consent and explains why beside the checkbox',async()=>{
  const {values,elements}=fixture();
  Object.assign(values,{entity_type:'LLC',state:'Wyoming',business_address:'Example business address',portfolio_choice:'private'});
  vi.mocked(fetch).mockImplementation(async()=>Response.json({documents:[{id:'sow',kind:'sow',hash:'b'.repeat(64),text:'Changed SOW'}]}));
  setupAgreementAccess();
  elements['[name="consent"]'].checked=true;
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(elements['[name="consent"]'].checked).toBe(false);
  expect(elements['[data-consent-updated]'].hidden).toBe(false);
});

it('keeps the matching review already rendered on page load',async()=>{
  const {elements}=fixture();
  elements['[name="documents"]'].value=JSON.stringify([{id:'sow',hash:'a'.repeat(64)}]);
  setupAgreementAccess();await new Promise(resolve=>setTimeout(resolve,0));
  expect(fetch).not.toHaveBeenCalled();
});

it.each([502, 'network'])('resets verification before enabling a failed link request (%s)',async failure=>{
  let submit!:Function;
  const button={disabled:false},status={textContent:''},reset=vi.fn(()=>expect(button.disabled).toBe(true));
  const form={action:'/api/offer/token/link',dataset:{},querySelector:()=>button,addEventListener:(_:string,fn:Function)=>{submit=fn;}};
  vi.stubGlobal('document',{querySelectorAll:()=>[form],querySelector:(selector:string)=>selector==='[data-signing-page]'?null:status});
  vi.stubGlobal('FormData',class{get(){return 'token';}});
  vi.stubGlobal('window',{turnstile:{reset}});
  vi.stubGlobal('fetch',vi.fn(async()=>{if(failure==='network')throw new Error('Offline');return Response.json({error:'Retry'},{status:502});}));
  setupAgreementAccess();
  await submit({preventDefault(){}});
  expect(reset).toHaveBeenCalledOnce();
  expect(button.disabled).toBe(false);
});
