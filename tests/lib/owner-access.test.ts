import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyOwnerAccess } from '~/lib/owner-access';

const issuer = 'https://owner-test.cloudflareaccess.com';
const audience = 'owner-application-audience';
const ownerEmail = 'owner@example.com';

async function signedRequest(claims: { email?: string; audience?: string } = {}) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const key = { ...await exportJWK(publicKey), kid: 'owner-test-key', alg: 'RS256', use: 'sig' };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [key] })));
  const token = await new SignJWT({ email: claims.email ?? ownerEmail, type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: key.kid })
    .setIssuer(issuer)
    .setAudience(claims.audience ?? audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  return new Request('https://thesuperhuman.us/owner', {
    headers: { 'cf-access-jwt-assertion': token },
  });
}

const env = {
  OWNER_ACCESS_TEAM_DOMAIN: issuer,
  OWNER_ACCESS_AUD: audience,
  OWNER_EMAIL: ownerEmail,
} as Env;

afterEach(() => vi.unstubAllGlobals());

describe('owner Access verification', () => {
  it('accepts a signed application token for the configured owner', async () => {
    await expect(verifyOwnerAccess(await signedRequest(), env)).resolves.toEqual({ email: ownerEmail });
  });

  it('rejects missing, wrong-audience and wrong-owner tokens', async () => {
    await expect(verifyOwnerAccess(new Request('https://thesuperhuman.us/owner'), env)).resolves.toBeNull();
    await expect(verifyOwnerAccess(await signedRequest({ audience: 'other-app' }), env)).resolves.toBeNull();
    await expect(verifyOwnerAccess(await signedRequest({ email: 'other@example.com' }), env)).resolves.toBeNull();
  });

  it('rejects invalid signatures and incomplete configuration', async () => {
    const request = await signedRequest();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [] })));
    await expect(verifyOwnerAccess(request, env)).resolves.toBeNull();
    await expect(verifyOwnerAccess(request, { ...env, OWNER_ACCESS_AUD: '' })).resolves.toBeNull();
  });
});
