import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { securityHeaders, withSecurityHeaders } from '~/lib/security-headers';

// Reads public/_headers the way wrangler does: trimmed, blank and # lines skipped, a path line starts a
// rule (the last block for a path wins), and Name: value lines add headers (repeats joined with ", ").
function headersFor(path: string) {
  const lines = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8').split('\n');
  let headers: Record<string, string> = {};
  let rule = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (/^([^\s]+:\/\/|\/)/.test(line)) {
      rule = line;
      if (rule === path) headers = {};
      continue;
    }
    if (rule !== path) continue;
    const separator = line.indexOf(':');
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }
  return headers;
}

describe('security headers', () => {
	it('adds a general report-only CSP while leaving route enforcement policies untouched', () => {
		expect(securityHeaders['content-security-policy-report-only']).toContain("script-src 'self'");
		expect(securityHeaders['content-security-policy-report-only']).toContain('https://challenges.cloudflare.com');
		expect(withSecurityHeaders(new Response('x')).headers.get('content-security-policy-report-only')).toBe(
			securityHeaders['content-security-policy-report-only'],
		);
		const oauth = withSecurityHeaders(new Response('x', {
			headers: { 'content-security-policy': "default-src 'none'; form-action 'self' https://github.com/login/oauth/authorize" },
		}));
		expect(oauth.headers.get('content-security-policy')).toBe("default-src 'none'; form-action 'self' https://github.com/login/oauth/authorize");
	});

  it('matches the /* block in public/_headers and ignores the workers.dev block', () => {
    expect(headersFor('/*')).toEqual(securityHeaders);
  });

  it('leaves interest-cohort out of the Permissions-Policy, as the owner decided', () => {
    expect(securityHeaders['permissions-policy']).not.toContain('interest-cohort');
  });

	it('adds all security headers to a plain response', () => {
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

  it('rethrows errors other than the immutable-headers TypeError', () => {
    const response = { headers: { has() { throw new RangeError('boom'); } } } as unknown as Response;
    expect(() => withSecurityHeaders(response)).toThrow(RangeError);
  });
});
