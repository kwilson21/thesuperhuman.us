import approved from '../../src/data/project-stories/threadline-review.json';
import type { Story } from '../../src/lib/publication/contract';
import {describe, expect, it} from 'vitest';
import {feedChange, publicationMilestones, journalMilestones, latestJournalMilestones, storyMilestones, archiveMilestones, journalSelection} from '../../src/lib/project-story';
import type {Milestone} from '../../src/lib/project-story';
import type {ProjectFeed, PublicEntry} from '../../src/lib/publication/read';
import {websiteMilestones, websiteStory} from '../../src/data/project-stories/personal-website';
import {tallyStory, tallyMilestones, tallyDecisionHighlights} from '../../src/data/project-stories/tally';
import {kailleraStory} from '../../src/data/project-stories/kaillera-next';
import {threadlineStory} from '../../src/data/project-stories/threadline';
import dailyStory from '../../src/data/project-stories/the-engineers-daily.json';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
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

describe('one journal for curated and published milestones', () => {
 const design = { id: 'website-design', day: '2026-09-09', title: 'Design', summary: 'A reviewed study.', artifacts: [] };
 it('retains curated visuals when the feed is empty or unavailable', () => {
  expect(journalMilestones(null, [design])).toEqual([design]);
  expect(journalMilestones(feed([]), [design])).toEqual([design]);
 });
 it('interleaves work by date and preserves same-day sequence', () => {
  const result = journalMilestones(feed([entry('launch', '2026-09-10'), entry('earlier', '2026-09-08')]), [design]);
  expect(result.map(m => m.id)).toEqual(['earlier', 'website-design', 'launch']);
  expect(result[1]).toBe(design);
 });
 it('keeps accessible before-and-after proof with its curated milestone', () => {
  const before = {src:'/before.webp',width:390,height:844,title:'Before',caption:'The controls overflowed on a phone.',kind:'Browser capture',alt:'A phone layout before the repair.'};
  const after = {src:'/after.webp',width:390,height:844,title:'After',caption:'The controls fit their content on a phone.',kind:'Browser capture',alt:'A phone layout after the repair.'};
  const repaired = {id:'mobile-repair',day:'2026-09-21',title:'Mobile repair',summary:'A narrow layout was corrected.',visualProof:{label:'Mobile layout before and after',before,after}} satisfies Milestone;
  expect(journalMilestones(null,[repaired])[0].visualProof).toEqual({label:'Mobile layout before and after',before,after});
 });
 it('includes the verified mobile bug fixes in the public curated history', () => {
  const ids = websiteMilestones.map(milestone => milestone.id);
  expect(ids).toEqual(expect.arrayContaining([
    'website-mobile-ab-playback',
    'website-mobile-comparison-layout',
    'website-owner-mobile-tooltips',
  ]));
 });

 it('pairs every documented mobile repair with an accessible before-and-after capture', () => {
  const repairs = websiteMilestones.filter(({ id }) => [
    'website-mobile-ab-playback',
    'website-mobile-comparison-layout',
    'website-owner-mobile-tooltips',
  ].includes(id));
  expect(repairs).toHaveLength(3);
  for (const repair of repairs) {
    expect(repair.visualProof?.before.kind).toBe('Browser capture');
    expect(repair.visualProof?.after.kind).toBe('Browser capture');
  }
 });

});

const chapter = (id: string, day: string): Milestone => ({id, day, title: id, summary: 'A chapter.', placement: 'story'});
const update = (id: string, day: string): Milestone => ({id, day, title: id, summary: 'An update.'});
describe('journal presentation: Latest work, Project story and Archive', () => {
 it('keeps an authored story chronological and never infers it from dates', () => {
  const entries = [chapter('b', '2026-09-10'), update('mixed-in', '2026-09-10'), chapter('a', '2026-09-09')];
  expect(storyMilestones(entries).map(e => e.id)).toEqual(['a', 'b']);
 });

 it('bounds Latest work to the limit, newest first, excluding the authored story', () => {
  const entries = [chapter('story-1', '2026-09-30'), update('e', '2026-09-25'), update('d', '2026-09-24'), update('c', '2026-09-23'), update('b', '2026-09-22'), update('a', '2026-09-21')];
  expect(latestJournalMilestones(entries).map(e => e.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
  expect(latestJournalMilestones(entries, 2).map(e => e.id)).toEqual(['e', 'd']);
 });

 it('keeps older, non-story updates reachable in the Archive rather than deleting them', () => {
  const entries = [update('e', '2026-09-25'), update('d', '2026-09-24'), update('c', '2026-09-23'), update('b', '2026-09-22'), update('a', '2026-09-21'), update('oldest', '2026-09-20')];
  expect(archiveMilestones(entries).map(e => e.id)).toEqual(['oldest']);
  expect(archiveMilestones(entries, 2).map(e => e.id)).toEqual(['c', 'b', 'a', 'oldest']);
 });

 it('never places a published entry into the authored story without an explicit editorial choice', () => {
  const published = publicationMilestones(feed([entry('shipped', '2026-09-25')]));
  expect(storyMilestones(published)).toEqual([]);
  expect(latestJournalMilestones(published).map(e => e.id)).toEqual(['shipped']);
 });

 it('classifies every curated Personal Website milestone deliberately, with no overlap and nothing lost', () => {
  const story = storyMilestones(websiteMilestones);
  const latest = latestJournalMilestones(websiteMilestones);
  const archive = archiveMilestones(websiteMilestones);
  expect(story.length).toBeGreaterThan(0);
  expect(latest.length).toBeLessThanOrEqual(5);
  const ids = [...story, ...latest, ...archive].map(e => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBe(websiteMilestones.length);
 });

 it('keeps the Personal Website project story at its full eleven authored chapters, in order', () => {
  // The spec originally capped a project story at five chapters; the owner amended it (Sept 26,
  // 2026) to an authored sequence with no fixed count once the redesign's own story reached eleven.
  const chapters = storyMilestones(websiteMilestones);
  expect(chapters).toHaveLength(11);
  expect(chapters.map(c => c.day)).toEqual([...chapters.map(c => c.day)].sort());
 });

 it('lets published entries push older curated entries out of Latest work and into the Archive', () => {
  const curated = [update('curated-a', '2026-09-01'), update('curated-b', '2026-09-02'), update('curated-c', '2026-09-03'), update('curated-d', '2026-09-04'), update('curated-e', '2026-09-05')];
  const merged = journalMilestones(feed([entry('published-1', '2026-09-10'), entry('published-2', '2026-09-09')]), curated);
  expect(latestJournalMilestones(merged).map(e => e.id)).toEqual(['published-1', 'published-2', 'curated-e', 'curated-d', 'curated-c']);
  expect(archiveMilestones(merged).map(e => e.id)).toEqual(['curated-b', 'curated-a']);
 });
});

describe('project status lives once, on the story data', () => {
 const astroFilesUnder = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = join(dir, entry.name);
  if (entry.isDirectory()) return astroFilesUnder(full);
  return entry.name.endsWith('.astro') ? [full] : [];
 });
 const pageFiles = [
  join('src', 'pages', 'index.astro'),
  join('src', 'pages', 'building.astro'),
  ...astroFilesUnder(join('src', 'pages', 'building')),
 ];
 const pageSources = pageFiles.map(file => ({ file, source: readFileSync(file, 'utf8') }));
 const statuses = [tallyStory.status, kailleraStory.status, websiteStory.status, dailyStory.status, threadlineStory.status];

 it('gives every project a single non-empty status', () => {
  for (const status of statuses) expect(status).toBeTruthy();
 });

 it('never calls the redesigned website an ongoing project', () => {
  expect(websiteStory.status.toLowerCase()).not.toContain('ongoing');
 });

 it('never hardcodes a status prop on a page', () => {
  const offenders = pageSources.filter(({ source }) => source.includes('status="')).map(({ file }) => file);
  expect(offenders).toEqual([]);
 });

 it('never repeats a project story status literally in page source instead of reading the data', () => {
  const offenders = pageSources.flatMap(({ file, source }) =>
   statuses.filter(status => source.includes(status)).map(status => `${file}: ${status}`));
  expect(offenders).toEqual([]);
 });
});

describe('journal default selection', () => {
 const newestFirst = [update('newest', '2026-09-25'), update('older', '2026-09-20')];
 const chronological = [chapter('first', '2026-09-09'), chapter('last', '2026-09-10')];

 it('opens Latest work and the Archive on their own newest entry, even if the live feed points elsewhere', () => {
  expect(journalSelection('latest', newestFirst, 'older', undefined)).toBe('newest');
  expect(journalSelection('archive', newestFirst, 'older', undefined)).toBe('newest');
  expect(journalSelection('latest', newestFirst, undefined, undefined)).toBe('newest');
 });

 it('opens the project story on its first chapter, not the live feed pointer', () => {
  expect(journalSelection('story', chronological, 'last', undefined)).toBe('first');
  expect(journalSelection('story', chronological, undefined, undefined)).toBe('first');
 });

 it('keeps the live feed pointer as the default for project pages with no named view', () => {
  expect(journalSelection(undefined, newestFirst, 'older', undefined)).toBe('older');
  expect(journalSelection(undefined, newestFirst, undefined, 'explicit')).toBe('explicit');
  expect(journalSelection(undefined, newestFirst, undefined, undefined)).toBeUndefined();
 });
});


describe('Tally decision highlight sources', () => {
 it('cites both AI entries in order and keeps every source resolvable', () => {
  expect(tallyDecisionHighlights.map(highlight => highlight.entries.map(source => source.entry))).toEqual([
   ['tally-jev-categorization', 'tally-merchant-names'],
   ['tally-design-system-catalog'],
   ['tally-demo-environment'],
  ]);
  for (const highlight of tallyDecisionHighlights) {
   expect(highlight).not.toHaveProperty('credit');
   for (const source of highlight.entries) {
    expect(source).not.toHaveProperty('id');
    expect(tallyMilestones.filter(milestone => milestone.id === source.entry)).toHaveLength(1);
   }
  }
 });
 it('pairs the merchant-name entry with its demo capture and supported copy', () => {
  const merchant = tallyMilestones.find(milestone => milestone.id === 'tally-merchant-names');
  expect(merchant?.day).toBe('2026-10-06');
  expect(merchant?.summary).toBe("Some bank text comes without a clean store name. Plaid’s merchant name comes first. When Plaid sends none, Workers AI suggests up to three names. A suggestion can appear provisionally in the list, dashed, but it becomes the saved name only when a person accepts it. A suggestion a person turns down isn’t offered again for that merchant record. Merchant-name suggestions are optional, with their own switch in Settings. Implemented and tested locally.");
  expect(merchant?.artifacts).toHaveLength(1);
  expect(merchant?.artifacts?.[0].kind).toBe('Screen capture, demo data');
  expect(tallyDecisionHighlights[0].relevance).toBe('You can change the category or reject the suggested name.');
  expect(tallyMilestones.at(-1)).toBe(merchant);
 });
});
