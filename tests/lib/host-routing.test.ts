import { describe, it, expect } from 'vitest';
import { rewritePathForHost } from '~/lib/host-routing';

describe('rewritePathForHost', () => {
  it('returns null for the software host', () => {
    expect(rewritePathForHost('thesuperhuman.us', '/')).toBeNull();
    expect(rewritePathForHost('thesuperhuman.us', '/about')).toBeNull();
    expect(rewritePathForHost('www.thesuperhuman.us', '/')).toBeNull();
  });

  it('prepends /audio for the audio host root', () => {
    expect(rewritePathForHost('audio.thesuperhuman.us', '/')).toBe('/audio/');
  });

  it('prepends /audio for audio host pages', () => {
    expect(rewritePathForHost('audio.thesuperhuman.us', '/about')).toBe('/audio/about');
    expect(rewritePathForHost('audio.thesuperhuman.us', '/file/slow-burn')).toBe('/audio/file/slow-burn');
  });

  it('does not rewrite API paths on the audio host', () => {
    expect(rewritePathForHost('audio.thesuperhuman.us', '/api/contact')).toBeNull();
    expect(rewritePathForHost('audio.thesuperhuman.us', '/api/audio-inquiry')).toBeNull();
  });

  it('does not rewrite already-prefixed paths', () => {
    expect(rewritePathForHost('audio.thesuperhuman.us', '/audio/')).toBeNull();
    expect(rewritePathForHost('audio.thesuperhuman.us', '/audio/about')).toBeNull();
  });

  it('strips the port from the host before matching', () => {
    expect(rewritePathForHost('audio.thesuperhuman.us:443', '/')).toBe('/audio/');
  });

  it('is case-insensitive on host matching', () => {
    expect(rewritePathForHost('AUDIO.thesuperhuman.us', '/')).toBe('/audio/');
  });

  it('returns null for unknown hosts', () => {
    expect(rewritePathForHost('example.com', '/')).toBeNull();
    expect(rewritePathForHost('localhost:4321', '/')).toBeNull();
  });
});

it('resolves shared navigation and local Audio paths without crossing site identities', async () => {
  const { mainSitePath, audioPath } = await import('~/lib/host-routing');
  expect(mainSitePath('audio.thesuperhuman.us', '/about')).toBe('https://thesuperhuman.us/about');
  expect(mainSitePath('127.0.0.1:4362', '/about')).toBe('/about');
  expect(audioPath('audio.thesuperhuman.us', '/about')).toBe('/about');
  expect(audioPath('127.0.0.1:4362', '/about')).toBe('/audio/about');
  expect(audioPath('audio.thesuperhuman.us', '/file/example')).toBe('/file/example');
});
