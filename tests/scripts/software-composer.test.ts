import { afterEach, expect, it, vi } from 'vitest';
import { setupSoftwareComposer } from '~/scripts/software-composer';

// Exercise the actual composer render and kind-change handlers without a browser service.
function fixture(saved=false) {
  const handlers=new Map<string,()=>void>();
  const fields: Record<string,any> = {};
  for (const name of ['what_changed','kind','milestone_index','artifact_version','review_window_days','checks_limitations','next_step','client_request','evidence_type','title','preview_url','next_update_on','email_client','visual_alt','visual','paid_confirmed']) {
    fields[name]={value: name==='kind' ? 'progress' : name==='milestone_index' ? '0' : name==='review_window_days' ? '5' : name==='evidence_type' ? 'concept' : '',checked:false,files:[],addEventListener:(event:string,handler:()=>void)=>handlers.set(`${name}:${event}`,handler),closest:()=>null};
  }
  const elements=new Map<string,any>();
  const element=(selector:string)=>{
    if (!elements.has(selector)) elements.set(selector,{hidden:false,textContent:'',addEventListener:vi.fn(),dataset:{accepted:'[true]'},classList:{toggle:vi.fn()},getAttribute:()=>null,removeAttribute:vi.fn()});
    return elements.get(selector);
  };
  const form={elements:{namedItem:(name:string)=>fields[name]},querySelector:(selector:string)=>selector.startsWith('[name=') && !selector.includes(' ') ? fields[selector.slice(6,-1)] : element(selector),querySelectorAll:()=>[],addEventListener:(event:string,handler:()=>void)=>handlers.set(`form:${event}`,handler)};
  const preview={querySelector:element,querySelectorAll:()=>[]};
  const root={dataset:{id:saved ? 'draft' : ''},querySelector:(selector:string)=>selector==='[data-update-form]' ? form : selector==='.client-preview' ? preview : element(selector)};
  vi.stubGlobal('document',{querySelector:()=>root});setupSoftwareComposer();
  return {fields,change:(kind:string)=>{fields.kind.value=kind;handlers.get('kind:change')!();},choose:()=>{handlers.get('email_client:change')!();handlers.get('form:input')!();}};
}
afterEach(()=>vi.unstubAllGlobals());
it.each(['direction_review','delivery_review','handoff'])('defaults new %s to email and preserves a manual opt-out',kind=>{
  const page=fixture();expect(page.fields.email_client.checked).toBe(false);
  page.change(kind);expect(page.fields.email_client.checked).toBe(true);
  page.fields.email_client.checked=false;page.choose();expect(page.fields.email_client.checked).toBe(false);
});
it('keeps the saved draft email choice on initial render',()=>{
  expect(fixture(true).fields.email_client.checked).toBe(false);
});
