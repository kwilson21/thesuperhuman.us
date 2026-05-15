import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '~/pages/api/resume-request';

const validBody = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  company: 'Acme',
  audience: 'dod',
  note: '',
  turnstileToken: 'tok',
};

function makeKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
  };
}

function makeContext(body: unknown, ip = '1.2.3.4', origin = 'https://thesuperhuman.us', kv?: ReturnType<typeof makeKv>) {
  const sharedKv = kv ?? makeKv();
  return {
    request: new Request('https://thesuperhuman.us/api/resume-request', {
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
          CONTACT_TO_EMAIL: 'kazon.wilson@thesuperhuman.us',
          CONTACT_FROM_EMAIL: 'noreply@thesuperhuman.us',
          RATE_LIMIT: sharedKv,
          RESUME_STORE: sharedKv,
        },
      },
    },
  } as any;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('challenges.cloudflare.com')) {
      return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
    }
    if (url.includes('resend.com')) {
      return { ok: true, json: async () => ({ id: 'em_1' }) } as unknown as Response;
    }
    return { ok: false, json: async () => ({}) } as unknown as Response;
  }));
});

describe('POST /api/resume-request', () => {
  it('returns 200 ok=true on valid submission', async () => {
    const res = await POST(makeContext(validBody));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('returns 400 with errors on invalid input', async () => {
    const res = await POST(makeContext({ ...validBody, audience: 'sales' }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; errors?: Record<string, string> };
    expect(json.ok).toBe(false);
    expect(json.errors?.audience).toBeDefined();
  });

  it('returns 403 on origin mismatch', async () => {
    const res = await POST(makeContext(validBody, '1.2.3.4', 'https://evil.example.com'));
    expect(res.status).toBe(403);
  });

  it('returns 403 on Turnstile failure', async () => {
    (fetch as any).mockImplementation(async (url: string) => {
      if (url.includes('challenges.cloudflare.com')) {
        return { ok: true, json: async () => ({ success: false }) };
      }
      return { ok: true, json: async () => ({ id: 'em' }) };
    });
    const res = await POST(makeContext(validBody));
    expect(res.status).toBe(403);
  });

  it('returns 429 when same IP submits twice within rate-limit window', async () => {
    const kv = makeKv();
    const first = await POST(makeContext(validBody, '1.2.3.4', 'https://thesuperhuman.us', kv));
    expect(first.status).toBe(200);
    const second = await POST(makeContext(validBody, '1.2.3.4', 'https://thesuperhuman.us', kv));
    expect(second.status).toBe(429);
  });

  it('returns 500 if approval notification email fails', async () => {
    (fetch as any).mockImplementation(async (url: string) => {
      if (url.includes('challenges.cloudflare.com')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (url.includes('resend.com')) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: false, json: async () => ({}) };
    });
    const res = await POST(makeContext(validBody));
    expect(res.status).toBe(500);
  });

  it('stores the request in KV and emails the operator with the approval link', async () => {
    const kv = makeKv();
    await POST(makeContext(validBody, '1.2.3.4', 'https://thesuperhuman.us', kv));
    const reqEntries = Array.from(kv.put.mock.calls).filter(c =>
      typeof c[0] === 'string' && c[0].startsWith('req:'),
    );
    expect(reqEntries.length).toBe(1);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const resendCall = fetchMock.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('resend.com'),
    );
    expect(resendCall).toBeTruthy();
    const body = JSON.parse((resendCall![1] as RequestInit).body as string);
    expect(body.to).toEqual(['kazon.wilson@thesuperhuman.us']);
    expect(body.text).toContain('/api/resume-approve?id=');
    expect(body.text).toContain('dod');
  });
});
