import { getCollection } from 'astro:content';
import { validateCatalog, visibleCatalog } from './music-catalog';
export async function loadMusicCatalog(preview = import.meta.env.DEV) {
  const [recordings, releases, examples] = await Promise.all([
    getCollection('recordings'), getCollection('releases'), getCollection('audio-examples'),
  ]);
  return visibleCatalog(validateCatalog({ recordings: recordings.map(e => e.data), releases: releases.map(e => e.data), examples: examples.map(e => e.data) }), preview);
}
