export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>;
}

const WINDOW_SECONDS = 300;

export async function checkRateLimit(
  kv: KvLike,
  ip: string,
): Promise<{ allowed: boolean }> {
  const key = `rl:${ip}`;
  const existing = await kv.get(key);
  if (existing) return { allowed: false };
  await kv.put(key, '1', { expirationTtl: WINDOW_SECONDS });
  return { allowed: true };
}
