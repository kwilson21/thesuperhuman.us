import { readdirSync, readFileSync } from 'node:fs';

const PUBLIC_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function publicReleasePages(releasesDirectory, site) {
  return readdirSync(releasesDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      try {
        const release = JSON.parse(readFileSync(new URL(entry.name, new URL(`${releasesDirectory.toString().replace(/\/$/, '')}/`, 'file:///')), 'utf8'));
        if (release.visibility !== 'public' || typeof release.slug !== 'string' || !PUBLIC_SLUG.test(release.slug)) return [];
        return [new URL(`/music/${release.slug}`, site).href];
      } catch {
        return [];
      }
    });
}

export function shouldIncludeSitemapPage(page) {
  const pathname = new URL(page).pathname.replace(/\/$/, '') || '/';
  if (pathname === '/services.html') return false;
  return !pathname.startsWith('/api/')
    && pathname !== '/owner'
    && !pathname.startsWith('/owner/')
    && !pathname.startsWith('/audio/file/')
    && !pathname.startsWith('/music/file/');
}
