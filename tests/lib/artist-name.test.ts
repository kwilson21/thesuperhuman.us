import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('artist name', () => {
  it('uses the approved plain Kazon spelling in release data and visible branding', () => {
    expect(JSON.parse(read('src/content/releases/old-news-single.json')).artist).toBe('Kazon');
    expect(JSON.parse(read('src/content/recordings/old-news-recording.json')).artist).toBe('Kazon');

    for (const path of [
      'src/components/SiteNav.astro',
      'src/components/Footer.astro',
      'src/layouts/OwnerLayout.astro',
      'src/pages/music/[slug].astro',
      'src/pages/audio/releases.astro',
    ]) {
      expect(read(path), path).not.toContain('z\u0304');
      expect(read(path), path).not.toContain('artist-macron');
    }
  });
});
