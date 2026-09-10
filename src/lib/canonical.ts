import { rewritePathForHost } from './host-routing';

export function publicCanonicalFor(url: URL, hostHeader: string | null): string {
  const pathname = rewritePathForHost(hostHeader ?? url.host, url.pathname) ?? url.pathname;
  return `https://thesuperhuman.us${pathname}${url.search}`;
}
