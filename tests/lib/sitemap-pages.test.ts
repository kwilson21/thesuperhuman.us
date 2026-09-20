import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { publicReleasePages, shouldIncludeSitemapPage } from '../../scripts/sitemap-pages.mjs';

describe('publicReleasePages', () => {
  it('adds public release detail pages without exposing drafts or malformed entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'website-sitemap-'));
    const releases = join(root, 'releases');
    mkdirSync(releases);
    writeFileSync(join(releases, 'public.json'), JSON.stringify({ slug: 'public-song', visibility: 'public' }));
    writeFileSync(join(releases, 'draft.json'), JSON.stringify({ slug: 'private-song', visibility: 'draft' }));
    writeFileSync(join(releases, 'unsafe.json'), JSON.stringify({ slug: '../api/private', visibility: 'public' }));
    writeFileSync(join(releases, 'broken.json'), '{');

    expect(publicReleasePages(releases, 'https://thesuperhuman.us')).toEqual([
      'https://thesuperhuman.us/music/public-song',
    ]);
  });
});

describe('shouldIncludeSitemapPage', () => {
  it('removes duplicate aliases and non-page routes from the public sitemap', () => {
    expect(shouldIncludeSitemapPage('https://thesuperhuman.us/services')).toBe(true);
    expect(shouldIncludeSitemapPage('https://thesuperhuman.us/audio/services')).toBe(true);
    expect(shouldIncludeSitemapPage('https://thesuperhuman.us/services.html')).toBe(false);
    expect(shouldIncludeSitemapPage('https://thesuperhuman.us/api/contact')).toBe(false);
    expect(shouldIncludeSitemapPage('https://thesuperhuman.us/owner')).toBe(false);
    expect(shouldIncludeSitemapPage('https://thesuperhuman.us/owner/requests')).toBe(false);
    expect(shouldIncludeSitemapPage('https://thesuperhuman.us/audio/file/example')).toBe(false);
    expect(shouldIncludeSitemapPage('https://thesuperhuman.us/music/file/example/master')).toBe(false);
  });
});
