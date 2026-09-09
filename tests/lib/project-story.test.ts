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
   expect(m.summary).toBe('A visible result.');
   expect(m.detail).toContain('The prototype is not released.');
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
