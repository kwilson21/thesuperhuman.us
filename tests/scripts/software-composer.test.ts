import { afterEach, expect, it, vi } from 'vitest';
import { setupSoftwareComposer } from '~/scripts/software-composer';

// Exercise the actual composer render and kind-change handlers without a browser service.
function fixture(saved=false, savedVisual='') {
  const handlers=new Map<string,(event?:any)=>void>();
  const fields: Record<string,any> = {};
  for (const name of ['what_changed','kind','milestone_index','artifact_version','review_window_days','checks_limitations','next_step','client_request','evidence_type','title','preview_url','next_update_on','email_client','visual_alt','visual','paid_confirmed']) {
    fields[name]={value: name==='kind' ? 'progress' : name==='milestone_index' ? '0' : name==='review_window_days' ? '5' : name==='evidence_type' ? 'concept' : '',checked:false,files:[],addEventListener:(event:string,handler:()=>void)=>handlers.set(`${name}:${event}`,handler),closest:()=>null};
  }
  const elements=new Map<string,any>();
  const element=(selector:string)=>{
    if (!elements.has(selector)) elements.set(selector,{hidden:false,textContent:'',addEventListener:vi.fn(),dataset:{accepted:'[true]'},classList:{toggle:vi.fn()},getAttribute:()=>selector==='[data-preview-image]' ? savedVisual : null,removeAttribute:vi.fn()});
    return elements.get(selector);
  };
  const form={reportValidity:()=>true,elements:{namedItem:(name:string)=>fields[name]},querySelector:(selector:string)=>selector.startsWith('[name=') && !selector.includes(' ') ? fields[selector.slice(6,-1)] : element(selector),querySelectorAll:()=>[],addEventListener:(event:string,handler:(event?:any)=>void)=>handlers.set(`form:${event}`,handler)};
  const preview={querySelector:element,querySelectorAll:()=>[]};
  const root={dataset:{id:saved ? 'draft' : '',endpoint:'/api/owner/requests/r/updates',projectUpdatedAt:'project-loaded'},querySelector:(selector:string)=>selector==='[data-update-form]' ? form : selector==='.client-preview' ? preview : element(selector)};
  vi.stubGlobal('document',{querySelector:()=>root});setupSoftwareComposer();
  return {fields,elements,fileChange:()=>handlers.get('visual:change')!(),submit:()=>handlers.get('form:submit')!({preventDefault:()=>{}} as never),change:(kind:string)=>{fields.kind.value=kind;handlers.get('kind:change')!();},choose:()=>{handlers.get('email_client:change')!();handlers.get('form:input')!();}};
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

it('keeps a browser-generated id through a failed first share and retry',async()=>{
  vi.stubGlobal('confirm',()=>true);
  vi.stubGlobal('FormData',class { getAll(){return [];} has(){return false;} *[Symbol.iterator](){yield ['title','Title'];yield ['what_changed','Changed'];} });
  vi.stubGlobal('location',{assign:vi.fn()});
  const id=crypto.randomUUID(),uuid=vi.spyOn(crypto,'randomUUID').mockReturnValue(id);
  const send=vi.fn().mockRejectedValueOnce(new Error('Lost response')).mockResolvedValue(Response.json({id,updatedAt:'now'}));vi.stubGlobal('fetch',send);
  const page=fixture();page.submit();await vi.waitFor(()=>expect(send).toHaveBeenCalledTimes(1));
  await new Promise(resolve=>setTimeout(resolve,0));page.submit();await vi.waitFor(()=>expect(send).toHaveBeenCalledTimes(2));
  for(const [,options] of send.mock.calls) expect(JSON.parse(options.body)).toMatchObject({updateId:id,expectedProjectUpdatedAt:'project-loaded'});
  expect(uuid).toHaveBeenCalledTimes(1);uuid.mockRestore();
});

it.each(['','/saved-visual'])('clears rejected replacements and restores saved visual %s', savedVisual=>{
  const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:staged');
  const page=fixture(Boolean(savedVisual),savedVisual);
  page.fields.visual.files=[{name:'valid.png',size:100,type:'image/png'}];page.fileChange();
  expect(page.elements.get('[data-preview-image]').src).toBe('blob:staged');
  Object.defineProperty(page.fields.visual,'value',{set:()=>{page.fields.visual.files=[];},get:()=>''});
  page.fields.visual.files=[{name:'rejected.pdf',size:100,type:'application/pdf'}];page.fileChange();
  expect(revoke).toHaveBeenCalledWith('blob:staged');
  expect(page.elements.get('[data-visual-name]').textContent).toBe('');
  expect(page.elements.get('[data-preview-figure]').hidden).toBe(!savedVisual);
  if(savedVisual) expect(page.elements.get('[data-preview-image]').src).toBe(savedVisual);
  else expect(page.elements.get('[data-preview-image]').removeAttribute).toHaveBeenCalledWith('src');
  expect(page.fields.visual.value).toBe('');
  expect(page.fields.visual_alt.required).toBe(Boolean(savedVisual));
  revoke.mockRestore();create.mockRestore();
});

it('restores the saved endpoint after uploading and then rejecting another replacement',async()=>{
  vi.stubGlobal('confirm',()=>true);
  vi.stubGlobal('FormData',class { getAll(){return [];} has(){return false;} *[Symbol.iterator](){yield ['title','Title'];} });
  vi.stubGlobal('location',{assign:vi.fn()});
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>Response.json({id:'draft',updatedAt:'now'})));
  const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
  const page=fixture();page.fields.visual_alt.value='A visual';
  Object.defineProperty(page.fields.visual,'value',{set:()=>{page.fields.visual.files=[];},get:()=>''});
  page.fields.visual.files=[{name:'first.png',size:100,type:'image/png'}];page.fileChange();page.submit();
  await vi.waitFor(()=>expect(location.assign).toHaveBeenCalled());
  page.fields.visual.files=[{name:'second.png',size:100,type:'image/png'}];page.fileChange();
  page.fields.visual.files=[{name:'rejected.png',size:6*1024*1024,type:'image/png'}];page.fileChange();
  expect(page.elements.get('[data-preview-image]').src).toBe('/api/owner/requests/r/updates/draft/visual');
  expect(page.elements.get('[data-preview-figure]').hidden).toBe(false);
  expect(revoke).toHaveBeenCalledWith('blob:first');expect(revoke).toHaveBeenCalledWith('blob:second');
  revoke.mockRestore();create.mockRestore();
});
