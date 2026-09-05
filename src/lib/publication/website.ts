import { readProject, type ProjectFeed } from './read';
/** Optional public data must never break page rendering. */
export async function websiteFeed(env: Env): Promise<ProjectFeed | null> {
  if (!env.PUBLICATION_DB || !(env.PUBLICATION_PROJECTS ?? '').split(',').map(p => p.trim()).includes('threadline')) return null;
  try { return await readProject(env.PUBLICATION_DB, 'threadline'); }
  catch { return null; }
}
