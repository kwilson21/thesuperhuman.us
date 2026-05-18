import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '~/pages/api/audio-inquiry';

const validBody = {
  name: 'Jane',
  email: 'jane@example.com',
  services: ['mixing'],
  trackCount: 3,
  targetDate: '2026-08-01',
  flexible: false,
  references: '',
  delivery: 'Dropbox',
  notes: 'A long enough description of the project that explains the work clearly.',
  turnstileToken: 'tok',
};

function makeKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  };
}

function makeContext(body: unknown, ip = '1.2.3.4', origin = 'https://audio.thesuperhuman.us') {
  const kv = makeKv();
  return {
    request: new Request('https://audio.thesuperhuman.us/api/audio-inquiry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': ip,
        origin,
      },
      body: JSON.stringify(body),
    }),
    locals: {
      runtime: {
        env: {
          RESEND_API_KEY: 'key',
          TURNSTILE_SECRET_KEY: 'secret',
          CONTACT_TO_EMAIL: 'kazon@x',
          CONTACT_FROM_EMAIL: 'noreply@notifs.x',
          RATE_LIMIT: kv,
        },
      },
    },
  } as any;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('challenges.cloudflare.com')) {
      return { ok: true, json: async () => ({ success: true }) } as any;
    }
    if (url.includes('resend.com')) {
      return { ok: true, json: async () => ({ id: 'em_1' }) } as any;
    }
    return { ok: false, json: async () => ({}) } as any;
  }));
});

describe('POST /api/audio-inquiry', () => {
  it('returns 200 ok=true on valid submission', async () => {
    const res = await POST(makeContext(validBody));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('returns 400 with errors on invalid input', async () => {
    const res = await POST(makeContext({ ...validBody, email: 'bad' }));
    expect(res.status).toBe(400);
  });

  it('rejects unknown origin', async () => {
    const res = await POST(makeContext(validBody, '1.2.3.4', 'https://evil.example.com'));
    expect(res.status).toBe(403);
  });

  it('accepts the audio.thesuperhuman.us origin', async () => {
    const res = await POST(makeContext(validBody, '1.2.3.4', 'https://audio.thesuperhuman.us'));
    expect(res.status).toBe(200);
  });

  it('returns 429 on a repeat IP within the window', async () => {
    const ctx1 = makeContext(validBody);
    const ctx2 = makeContext(validBody);
    // share the KV via spy
    const sharedKv = makeKv();
    ctx1.locals.runtime.env.RATE_LIMIT = sharedKv;
    ctx2.locals.runtime.env.RATE_LIMIT = sharedKv;
    await POST(ctx1);
    const res2 = await POST(ctx2);
    expect(res2.status).toBe(429);
  });

  it('uses the rl:audio: KV prefix', async () => {
    const ctx = makeContext(validBody);
    await POST(ctx);
    const calls = (ctx.locals.runtime.env.RATE_LIMIT as any).put.mock.calls;
    expect(calls[0][0]).toMatch(/^rl:audio:/);
  });

  it('returns 403 when Turnstile fails', async () => {
    (fetch as any).mockImplementation(async (url: string) => {
      if (url.includes('challenges.cloudflare.com')) {
        return { ok: true, json: async () => ({ success: false }) } as any;
      }
      return { ok: true } as any;
    });
    const res = await POST(makeContext(validBody));
    expect(res.status).toBe(403);
  });
});
