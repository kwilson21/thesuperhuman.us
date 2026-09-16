import { describe, it, expect } from 'vitest';
import { publicCanonicalFor } from '~/lib/canonical';

describe('publicCanonicalFor', () => {
  it('returns the software host for non-audio requests', () => {
    const url = new URL('https://thesuperhuman.us/about');
    expect(publicCanonicalFor(url, 'thesuperhuman.us')).toBe('https://thesuperhuman.us/about');
  });

  it('treats www as the software host', () => {
    const url = new URL('https://www.thesuperhuman.us/about');
    expect(publicCanonicalFor(url, 'www.thesuperhuman.us')).toBe('https://thesuperhuman.us/about');
  });

  it('uses the main Audio canonical for the alternate host', () => {
    const url = new URL('https://audio.thesuperhuman.us/audio/about');
    expect(publicCanonicalFor(url, 'audio.thesuperhuman.us')).toBe('https://thesuperhuman.us/audio/about');
  });

  it('keeps the main Audio path for the alternate host root', () => {
    const url = new URL('https://audio.thesuperhuman.us/audio/');
    expect(publicCanonicalFor(url, 'audio.thesuperhuman.us')).toBe('https://thesuperhuman.us/audio');
  });

  it('handles a hostHeader with port', () => {
    const url = new URL('https://audio.thesuperhuman.us/audio/about');
    expect(publicCanonicalFor(url, 'audio.thesuperhuman.us:443')).toBe('https://thesuperhuman.us/audio/about');
  });

  it('falls back to url.host when hostHeader is null', () => {
    const url = new URL('https://audio.thesuperhuman.us/audio/about');
    expect(publicCanonicalFor(url, null)).toBe('https://thesuperhuman.us/audio/about');
  });

  it('omits tracking query strings from canonical URLs', () => {
    const url = new URL('https://audio.thesuperhuman.us/audio/about?x=1');
    expect(publicCanonicalFor(url, 'audio.thesuperhuman.us')).toBe('https://thesuperhuman.us/audio/about');
  });
});

it('canonicalizes unrewritten subdomain entry points without losing their suffix', () => {
  expect(publicCanonicalFor(new URL('https://audio.thesuperhuman.us/'), null)).toBe('https://thesuperhuman.us/audio');
  expect(publicCanonicalFor(new URL('https://audio.thesuperhuman.us/services?ref=card'), null)).toBe('https://thesuperhuman.us/audio/services');
});

it('uses the same canonical for trailing-slash page aliases', () => {
  expect(publicCanonicalFor(new URL('https://thesuperhuman.us/about/?utm_source=test'), null)).toBe('https://thesuperhuman.us/about');
  expect(publicCanonicalFor(new URL('https://thesuperhuman.us/'), null)).toBe('https://thesuperhuman.us/');
});
