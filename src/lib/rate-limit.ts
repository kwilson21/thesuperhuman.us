export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>;
}

const WINDOW_SECONDS = 300;

export async function checkRateLimit(
  kv: KvLike,
  ip: string,
  prefix = 'rl:',
): Promise<{ allowed: boolean }> {
  const key = `${prefix}${ip}`;
  const existing = await kv.get(key);
  if (existing) return { allowed: false };
  // Note: there is a small race window between the get above returning null and
  // the put below being visible to other edge nodes. Cloudflare KV does not
  // support atomic check-and-set, so two concurrent requests from the same IP
  // could both pass. For this site (low traffic, Turnstile as primary defense)
  // the risk is acceptable. KV's eventual-consistency also means a put from one
  // edge may take ~60 s to propagate to another, so this rate limit is
  // best-effort across the network; the 5-min window provides natural slack.
  await kv.put(key, '1', { expirationTtl: WINDOW_SECONDS });
  return { allowed: true };
}
