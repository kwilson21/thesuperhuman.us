import { describe, it, expect, vi } from 'vitest';
import { checkRateLimit } from '~/lib/rate-limit';

function makeKvStub() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string, _opts?: { expirationTtl: number }) => {
      store.set(k, v);
    }),
  };
}

describe('checkRateLimit', () => {
  it('allows the first request from an IP', async () => {
    const kv = makeKvStub();
    const result = await checkRateLimit(kv as any, '1.2.3.4');
    expect(result.allowed).toBe(true);
  });

  it('records the IP after first call', async () => {
    const kv = makeKvStub();
    await checkRateLimit(kv as any, '1.2.3.4');
    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(kv.put.mock.calls[0][0]).toBe('rl:1.2.3.4');
    expect(kv.put.mock.calls[0][2]).toEqual({ expirationTtl: 300 });
  });

  it('denies a second request within the window', async () => {
    const kv = makeKvStub();
    await checkRateLimit(kv as any, '1.2.3.4');
    const result = await checkRateLimit(kv as any, '1.2.3.4');
    expect(result.allowed).toBe(false);
  });

  it('allows requests from a different IP', async () => {
    const kv = makeKvStub();
    await checkRateLimit(kv as any, '1.2.3.4');
    const result = await checkRateLimit(kv as any, '5.6.7.8');
    expect(result.allowed).toBe(true);
  });

  it('uses a 300-second TTL', async () => {
    const kv = makeKvStub();
    await checkRateLimit(kv as any, '1.2.3.4');
    expect(kv.put.mock.calls[0][2]).toEqual({ expirationTtl: 300 });
  });

  it('uses a custom prefix when provided', async () => {
    const kv = makeKvStub();
    await checkRateLimit(kv as any, '1.2.3.4', 'rl:audio:');
    expect(kv.put.mock.calls[0][0]).toBe('rl:audio:1.2.3.4');
    expect(kv.get.mock.calls[0][0]).toBe('rl:audio:1.2.3.4');
  });
});
