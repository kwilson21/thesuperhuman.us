import { rewritePathForHost } from './host-routing';

export function publicCanonicalFor(url: URL, hostHeader: string | null): string {
  const pathname = rewritePathForHost(hostHeader ?? url.host, url.pathname) ?? url.pathname;
  const canonicalPath = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
  return `https://thesuperhuman.us${canonicalPath}`;
}
