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
