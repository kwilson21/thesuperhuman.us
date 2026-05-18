const AUDIO_HOST = 'audio.thesuperhuman.us';
const SOFTWARE_HOST = 'thesuperhuman.us';

export function publicCanonicalFor(url: URL, hostHeader: string | null): string {
  const host = (hostHeader ?? url.host).split(':')[0].toLowerCase();
  const isAudio = host === AUDIO_HOST;
  const targetHost = isAudio ? AUDIO_HOST : SOFTWARE_HOST;

  let pathname = url.pathname;
  if (isAudio) {
    if (pathname === '/audio' || pathname === '/audio/') {
      pathname = '/';
    } else if (pathname.startsWith('/audio/')) {
      pathname = pathname.slice('/audio'.length);
    }
  }

  return `https://${targetHost}${pathname}${url.search}`;
}
