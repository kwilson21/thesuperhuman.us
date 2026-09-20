import { createRemoteJWKSet, jwtVerify } from 'jose';

export type OwnerIdentity = { email: string };
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keySet(issuer: string) {
  let current = keySets.get(issuer);
  if (!current) {
    current = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer));
    keySets.set(issuer, current);
  }
  return current;
}

export async function verifyOwnerAccess(request: Request, env: Env): Promise<OwnerIdentity | null> {
  const issuer = env.OWNER_ACCESS_TEAM_DOMAIN;
  const audience = env.OWNER_ACCESS_AUD;
  const ownerEmail = env.OWNER_EMAIL;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!issuer || !audience || !ownerEmail || !token) return null;
  try {
    const { payload } = await jwtVerify(token, keySet(issuer), {
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
