import { describe, expect, it } from 'vitest';
import { validateCatalog, visibleCatalog } from '~/lib/music-catalog';

const recording = { id: 'old-news-recording', title: 'Old News', artist: 'Kazon', duration: 160, visibility: 'draft', credits: [], versions: { master: { key: 'music/old-news-recording/master-abcd1234.mp3', type: 'audio/mpeg' } } };
const single = { id: 'old-news-single', slug: 'old-news', title: 'Old News', artist: 'Kazon', type: 'single', status: 'preview', visibility: 'draft', artwork: '/music/old-news.webp', tracks: ['old-news-recording'] };
describe('music catalog', () => {
  it('allows a same-title album to reference the same recording with a different URL', () => {
    const catalog = validateCatalog({ recordings: [recording], releases: [single, { ...single, id: 'old-news-album', slug: 'old-news-album', type: 'album' }], examples: [] });
    expect(catalog.releases.map(r => r.slug)).toEqual(['old-news', 'old-news-album']);
  });
  it('rejects URL collisions and missing recording references', () => {
    expect(() => validateCatalog({ recordings: [recording], releases: [single, { ...single, id: 'other' }], examples: [] })).toThrow(/slug/);
    expect(() => validateCatalog({ recordings: [], releases: [single], examples: [] })).toThrow(/recording/);
  });
  it('hides drafts and rejects unsafe media paths', () => {
    const c = validateCatalog({ recordings: [recording], releases: [single], examples: [] });
    expect(visibleCatalog(c, false).releases).toHaveLength(0);
    expect(visibleCatalog(c, true).releases).toHaveLength(1);
    expect(() => validateCatalog({ recordings: [{ ...recording, versions: { master: { key: '../private.json', type: 'audio/mpeg' } } }], releases: [single], examples: [] })).toThrow();
    expect(() => validateCatalog({ recordings: [{ ...recording, youtubeUrl: 'https://youtu.be/not-an-id' }], releases: [single], examples: [] })).toThrow();
    expect(() => validateCatalog({ recordings: [{ ...recording, soundcloudUrl: 'https://soundcloud.com/' }], releases: [single], examples: [] })).toThrow();
  });
});

it('supports mix-only portfolio work with explicit methodology and credited roles', () => {
  const mixOnly = { ...recording, services: ['full-mix'], versions: { mix: recording.versions.master, unmixed: recording.versions.master } };
  const example = { id: 'full-mix-demo', recordingId: mixOnly.id, visibility:'draft', service:'mixing', methodology:'full-mix', summary:'Full mix', before:'unmixed', after:'mix' };
  expect(validateCatalog({recordings:[mixOnly],releases:[],examples:[example]}).examples[0].alignment).toEqual({before:0,after:0});
  expect(() => validateCatalog({recordings:[mixOnly],releases:[],examples:[{...example,methodology:'mastering'}]})).toThrow();
  expect(() => validateCatalog({recordings:[mixOnly],releases:[],examples:[{...example,methodology:'two-track-vocals'}]})).toThrow();
});
it('rejects invalid comparison pairs and waveform amplitudes', () => {
  const track = {...recording,versions:{master:recording.versions.master,mix:recording.versions.master}};
  const example = {id:'mastering-demo', recordingId:track.id, visibility:'draft',service:'mastering',summary:'Mastering',before:'mix',after:'master'};
  expect(() => validateCatalog({recordings:[track],releases:[],examples:[{...example,after:'mix'}]})).toThrow();
  expect(() => validateCatalog({recordings:[track],releases:[],examples:[{...example,waveforms:{before:[2],after:[1]}}]})).toThrow();
});

it.each([
  ['master', 'mp4', 'video/mp4'], ['mix', 'mp4', 'audio/mpeg'],
  ['unmixed', 'mp3', 'video/mp4'], ['video', 'mp3', 'audio/mpeg'],
  ['video', 'mp4', 'audio/mpeg'], ['master', 'mp3', 'video/mp4'],
])('rejects a %s slot with .%s and %s', (slot, suffix, type) => {
  const track = { ...recording, versions: { ...recording.versions, [slot]: { key: `music/song/export.${suffix}`, type } } };
  expect(() => validateCatalog({ recordings: [track], releases: [], examples: [] })).toThrow();
});
