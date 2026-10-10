import { hashValue } from './audio-client-access';
export const suggestionPassCookie = '__Secure-brief-suggestion-pass';
const lifetime = 30 * 60 * 1000;
export const suggestionVisitorHash = (ip: string, now = Date.now()) => hashValue(`${Math.floor(now / 86400000)}:${ip}`);
async function passKey(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const message = (payload: string) => new TextEncoder().encode(`brief-suggestion-pass:v1:${payload}`);
export async function createSuggestionPass(secret: string, ip: string, now = Date.now()): Promise<string> {
  const payload = `${now + lifetime}.${await suggestionVisitorHash(ip, now)}`;
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await passKey(secret), message(payload)));
  return `${payload}.${Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
export async function validSuggestionPass(value: string | undefined, secret: string, ip: string): Promise<boolean> {
  if (!value || !/^\d+\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(value)) return false;
  const [expires, hash, signature] = value.split('.');
  const now = Date.now();
  if (Number(expires) <= now || Number(expires) > now + lifetime || hash !== await suggestionVisitorHash(ip, now)) return false;
  const bytes = Uint8Array.from(signature.match(/../g)!, hex => parseInt(hex, 16));
  return crypto.subtle.verify('HMAC', await passKey(secret), bytes, message(`${expires}.${hash}`));
}
