import approved from '../../src/data/project-stories/threadline-review.json';
import type { Story } from '../../src/lib/publication/contract';
import {describe, expect, it} from 'vitest';
import {feedChange, publicationMilestones} from '../../src/lib/project-story';
import type {ProjectFeed, PublicEntry} from '../../src/lib/publication/read';
const entry = (id: string, day = '2026-09-09'): PublicEntry => ({entryId:id,occurredOn:day,publishedAt:day+'T12:00:00Z',backfilled:false,story:{basis:'repository-verified',delivery:'implemented',headline:id,summary:'A visible result. The prototype is not released.',technicalDetail:null}});
const feed = (items: PublicEntry[], revision = 1): ProjectFeed => ({projectId:'threadline',revision,current:items[0]??null,history:items});
describe('project story publication projection',()=>{
 it('orders earlier work first without losing same-day publication order or duplicating current',()=>{
   const f=feed([entry('new'),entry('same-day'),entry('old','2026-09-08')]);
   expect(publicationMilestones(f).map(e=>e.id)).toEqual(['old','same-day','new']);
 });
 it('retains full published context and evidence basis',()=>{
   const [m]=publicationMilestones(feed([entry('new')]));
   expect(m.summary).toBe('A visible result. The prototype is not released.');
   expect(m.detail).toBe('');
   expect(m.basis).toBe('repository-verified');
   expect(m.publishedAt).toBe('2026-09-09T12:00:00Z');
   expect(publicationMilestones(feed([{...entry('past'),backfilled:true}]))[0].backfilled).toBe(true);
 });
 it('offers new entries without replacing the displayed snapshot',()=>{
   const old=entry('old');expect(feedChange(feed([old]),feed([entry('new'),old],2))).toBe('new');
 });
 it('requires clearing withdrawn or corrected content immediately',()=>{
   const old=entry('old');expect(feedChange(feed([old]),feed([],2))).toBe('replace');
   expect(feedChange(feed([old]),feed([{...old,story:{...old.story,summary:'Corrected.'}}],2))).toBe('replace');
 });
 it('does not treat a changed current pointer as the removal of historical content',()=>{
   const old=entry('old');expect(feedChange(feed([old]),feed([entry('new'),old],2))).toBe('new');
 });
 it('rejects another project and recognizes identical snapshots',()=>{
   const f=feed([entry('same')]);expect(feedChange(f,{...f,projectId:'other'})).toBe('ignore');expect(feedChange(f,f)).toBe('unchanged');
 });
 it('clears a reset that removes prior content',()=>expect(feedChange(feed([entry('old')],5),feed([],0))).toBe('replace'));
});

const reviewedEntry = (): PublicEntry => ({entryId:approved.entryId,occurredOn:approved.occurredOn,publishedAt:'2026-09-09T23:00:00Z',backfilled:true,story:{...approved.story} as Story});
describe('reviewed milestone illustration',()=>{
 it('attaches only to the reviewed story in its project and preserves the full short explanation',()=>{
  const e=reviewedEntry();const [m]=publicationMilestones(feed([e]));
  expect(m.illustration).toBe('payload-review');expect(m.detailLabel).toBe('What was checked');expect(m.summary).toBe(e.story.summary);
  expect(publicationMilestones({...feed([e]),projectId:'other'})[0].illustration).toBeUndefined();
  expect(publicationMilestones(feed([{...e,entryId:'other'}]))[0].illustration).toBeUndefined();
  expect(publicationMilestones(feed([{...e,occurredOn:'2026-09-06'}]))[0].illustration).toBeUndefined();
 });
 it('removes the illustration for a correction to any reviewed story field or a withdrawal',()=>{
  for(const key of Object.keys(approved.story) as (keyof Story)[]){
   const e=reviewedEntry();Object.assign(e.story,{[key]:'Changed'});
   expect(publicationMilestones(feed([e]))[0].illustration).toBeUndefined();
  }
  expect(publicationMilestones(feed([]))).toEqual([]);
 });
 it('keeps the illustration when unrelated work advances the project revision',()=>{
  const e=reviewedEntry();expect(publicationMilestones(feed([entry('later'),e],99)).find(m=>m.id===e.entryId)?.illustration).toBe('payload-review');
 });
});
