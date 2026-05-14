const ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp: string,
): Promise<boolean> {
  try {
    const body = new URLSearchParams();
    body.set('secret', secret);
    body.set('response', token);
    body.set('remoteip', remoteIp);

    const res = await fetch(ENDPOINT, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
