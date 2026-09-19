import { createRemoteJWKSet, jwtVerify } from 'jose';

export type OwnerIdentity = { email: string };

export async function verifyOwnerAccess(request: Request, env: Env): Promise<OwnerIdentity | null> {
  const issuer = env.OWNER_ACCESS_TEAM_DOMAIN;
  const audience = env.OWNER_ACCESS_AUD;
  const ownerEmail = env.OWNER_EMAIL;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!issuer || !audience || !ownerEmail || !token) return null;
  try {
    const jwks = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer));
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience,
      algorithms: ['RS256'],
    });
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    return email === ownerEmail.toLowerCase() ? { email } : null;
  } catch {
    return null;
  }
}
