const AUDIO_HOST = 'audio.thesuperhuman.us';

/**
 * If the request should be internally rewritten, returns the new pathname.
 * Returns null if no rewrite is required (the original pathname should be used).
 */
export function rewritePathForHost(host: string, pathname: string): string | null {
  const hostNoPort = host.split(':')[0].toLowerCase();
  if (hostNoPort !== AUDIO_HOST) return null;

  if (pathname.startsWith('/api/')) return null;
  if (pathname === '/audio' || pathname.startsWith('/audio/')) return null;

  if (pathname === '/') return '/audio/';
  return `/audio${pathname}`;
}

/** Main-site links must leave the Audio host; local previews stay local. */
export function mainSitePath(host: string, pathname: string): string {
  return host.split(':')[0].toLowerCase() === AUDIO_HOST ? `https://thesuperhuman.us${pathname}` : pathname;
}

/** Audio routes are mounted at / on their host and /audio in the main preview. */
export function audioPath(host: string, pathname: string): string {
  return host.split(':')[0].toLowerCase() === AUDIO_HOST ? pathname : `/audio${pathname}`;
}
