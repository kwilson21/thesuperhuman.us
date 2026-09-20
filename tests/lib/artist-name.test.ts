import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('Kaz̄on wordmark', () => {
  it('draws the macron as part of a reusable accessible name treatment', () => {
    const component = read('src/components/ArtistName.astro');

    expect(component).toContain('aria-label={`Kaz̄on${suffix}`}');
    expect(component).toContain('class="artist-z"');
    expect(component).toContain('.artist-z::after');
    expect(component).toContain('background: currentColor');
  });

  it('uses the shared treatment in prominent site and music branding', () => {
    for (const path of [
      'src/components/SiteNav.astro',
      'src/components/Footer.astro',
      'src/layouts/OwnerLayout.astro',
      'src/pages/music/[slug].astro',
      'src/pages/audio/releases.astro',
      'src/pages/audio/start.astro',
      'src/components/audio/ReleaseInterest.astro',
    ]) {
      expect(read(path), path).toContain('ArtistName');
    }
  });
});
