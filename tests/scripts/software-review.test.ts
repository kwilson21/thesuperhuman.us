import { afterEach, expect, it, vi } from 'vitest';
import { setupSoftwareReviews } from '~/scripts/software-review';

function fixture(direction=false) {
  let submit: (event:unknown)=>Promise<void>;
  const note={value:'',focus:vi.fn()},status={textContent:''},buttons=[{disabled:false},{disabled:false}];
  let selected:string[]=[],missing:string[]=[],inaccessible:string[]=[];
  const form={dataset:{endpoint:'/api/studio/software/r/reviews/u',version:'Delivery v1',milestone:'Tracker',direction:String(direction)},
    querySelector:(selector:string)=>selector==='[name=note]' ? note : status,querySelectorAll:()=>buttons,
    addEventListener:(_name:string,handler:typeof submit)=>{submit=handler;}};
  vi.stubGlobal('document',{querySelectorAll:()=>[form]});
  vi.stubGlobal('FormData',class {getAll(name:string){return name==='criteria'?selected:name==='missing_deliverables'?missing:name==='inaccessible_deliverables'?inaccessible:[];}});
  vi.stubGlobal('confirm',vi.fn(()=>true));vi.stubGlobal('location',{reload:vi.fn()});
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:true})));
  setupSoftwareReviews();
  return {note,status,buttons,select:(values:string[])=>{selected=values;},selectMissing:(values:string[])=>{missing=values;},selectInaccessible:(values:string[])=>{inaccessible=values;},submit:(decision:string)=>submit({preventDefault:vi.fn(),submitter:{value:decision}})};
}
afterEach(()=>vi.unstubAllGlobals());
it('requires delivery criteria and reproduction notes without sending an invalid decision',async()=>{
  const page=fixture();await page.submit('changes_requested');expect(fetch).not.toHaveBeenCalled();expect(page.note.focus).toHaveBeenCalled();
  page.note.value='Try the fictional sample.';await page.submit('changes_requested');expect(fetch).not.toHaveBeenCalled();
  page.select(['0']);await page.submit('changes_requested');expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({decision:'changes_requested',confirm:false,criteria:[0],missing_deliverables:[],inaccessible_deliverables:[],note:'Try the fictional sample.'});
});
it('requires identified-version confirmation for acceptance and leaves cancel unsent',async()=>{
  const page=fixture();vi.mocked(confirm).mockReturnValueOnce(false);await page.submit('milestone_accepted');expect(fetch).not.toHaveBeenCalled();
  await page.submit('milestone_accepted');expect(confirm).toHaveBeenCalledWith('Accept Delivery v1 of Tracker? This confirms it meets the agreed checks. New features are scoped separately.');
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).confirm).toBe(true);expect(location.reload).toHaveBeenCalled();
});
it('permits direction change notes without delivery criteria and exposes server conflicts',async()=>{
  const page=fixture(true);page.note.value='Move the status beside the client.';
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({error:'This review changed.'},{status:409}));
  await page.submit('changes_requested');expect(page.status.textContent).toBe('This review changed.');expect(page.buttons.every(button=>!button.disabled)).toBe(true);expect(location.reload).not.toHaveBeenCalled();
});

it('permits reporting a missing deliverable without incorrectly marking a passing check unmet',async()=>{
  const page=fixture();page.note.value='The sample import is not included.';page.selectMissing(['1']);await page.submit('changes_requested');
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({decision:'changes_requested',criteria:[],missing_deliverables:[1],inaccessible_deliverables:[],note:'The sample import is not included.'});
});
it('sends included but inaccessible items through a separate selection',async()=>{
  const page=fixture();page.note.value='I cannot open the view.';page.selectInaccessible(['0']);await page.submit('changes_requested');
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({decision:'changes_requested',criteria:[],missing_deliverables:[],inaccessible_deliverables:[0],note:'I cannot open the view.'});
});
