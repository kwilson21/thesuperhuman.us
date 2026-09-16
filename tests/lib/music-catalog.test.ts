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
  });
});
