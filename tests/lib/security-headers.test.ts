import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { securityHeaders, withSecurityHeaders } from '~/lib/security-headers';

// Reads the indented Name: value lines under one path line in public/_headers.
function headersFor(path: string) {
  const lines = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8').split('\n');
  const headers: Record<string, string> = {};
  let inBlock = false;
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    if (!inBlock) {
      inBlock = line === path;
      continue;
    }
    if (line.trim() === '' || !/^\s/.test(line)) break;
    const separator = line.indexOf(':');
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return headers;
}

describe('security headers', () => {
  it('matches the /* block in public/_headers and ignores the workers.dev block', () => {
    expect(headersFor('/*')).toEqual(securityHeaders);
  });

  it('adds all four headers to a plain response', () => {
    const response = withSecurityHeaders(new Response('x'));
    expect(Object.fromEntries(response.headers)).toMatchObject(securityHeaders);
  });

  it('keeps headers a route or boundary already set', () => {
    const response = withSecurityHeaders(new Response('x', {
      headers: { 'referrer-policy': 'no-referrer', 'x-frame-options': 'SAMEORIGIN' },
    }));
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('adds headers to immutable redirect responses without losing the redirect', () => {
    const response = withSecurityHeaders(Response.redirect('https://thesuperhuman.us/next', 302));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://thesuperhuman.us/next');
    expect(Object.fromEntries(response.headers)).toMatchObject(securityHeaders);
  });
});
