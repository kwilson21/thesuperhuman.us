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

  it('strips the /audio prefix on the audio host', () => {
    const url = new URL('https://audio.thesuperhuman.us/audio/about');
    expect(publicCanonicalFor(url, 'audio.thesuperhuman.us')).toBe('https://audio.thesuperhuman.us/about');
  });

  it('maps /audio/ to / on the audio host root', () => {
    const url = new URL('https://audio.thesuperhuman.us/audio/');
    expect(publicCanonicalFor(url, 'audio.thesuperhuman.us')).toBe('https://audio.thesuperhuman.us/');
  });

  it('handles a hostHeader with port', () => {
    const url = new URL('https://audio.thesuperhuman.us/audio/about');
    expect(publicCanonicalFor(url, 'audio.thesuperhuman.us:443')).toBe('https://audio.thesuperhuman.us/about');
  });

  it('falls back to url.host when hostHeader is null', () => {
    const url = new URL('https://audio.thesuperhuman.us/audio/about');
    expect(publicCanonicalFor(url, null)).toBe('https://audio.thesuperhuman.us/about');
  });

  it('preserves query strings', () => {
    const url = new URL('https://audio.thesuperhuman.us/audio/about?x=1');
    expect(publicCanonicalFor(url, 'audio.thesuperhuman.us')).toBe('https://audio.thesuperhuman.us/about?x=1');
  });
});
