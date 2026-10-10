import {expect,it,vi} from 'vitest';
import {setupAgreementAttachments} from '~/scripts/software-offers';

it('blocks overlapping uploads and merges into the current attachment manifest',async()=>{
  let click!:()=>Promise<void>,finish!:(response:Response)=>void;
  const upload={disabled:false,addEventListener:(_:string,fn:typeof click)=>{click=fn;}};
  const field={value:JSON.stringify([{key:'removed'}]),dispatchEvent:vi.fn()};
  const nodes:Record<string,unknown>={
    '[data-upload-attachment]':upload,'[name="agreement.attachments"]':field,
    '[data-attachment-file]':{files:[{name:'sample.pdf'}]},'[data-attachment-version]':{value:'v1'},'[data-attachment-date]':{value:'2026-10-10'},
    '[data-attachment-list]':{appendChild:vi.fn()},
  };
  const block={dataset:{uploadEndpoint:'/upload'},addEventListener:vi.fn(),querySelector:(s:string)=>nodes[s],closest:()=>({querySelector:()=>({textContent:''})})};
  vi.stubGlobal('document',{createElement:()=>({dataset:{},appendChild:vi.fn()})});
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
  setupAgreementAttachments(block as never);
  const pending=click();
  expect(upload.disabled).toBe(true);
  await click();expect(fetch).toHaveBeenCalledOnce();
  field.value=JSON.stringify([{key:'latest'}]);
  finish(Response.json({attachment:{key:'new',filename:'sample.pdf'}}));await pending;
  expect(JSON.parse(field.value).map((a:{key:string})=>a.key)).toEqual(['latest','new']);
  expect(upload.disabled).toBe(false);
  vi.unstubAllGlobals();
});
