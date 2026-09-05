import { describe, expect, it, vi } from 'vitest';
import { GET, POST } from '~/pages/api/work-feed';

const update = {
  schemaVersion: 1,
  projectId: 'threadline',
  projectName: 'Threadline',
  headline: 'Orchestrating live provisional threads',
  summary: 'Directing agents as they connect bounded evidence to a continuously revised public-safe projection.',
  status: 'active',
  revision: 3,
  updatedAt: '2026-09-05T19:30:00.000Z',
  links: [{ label: 'Repository', url: 'https://github.com/kwilson21/threadline' }],
};

function makeKv(initial?: string) {
  const store = new Map<string, string>();
  if (initial) store.set('work-feed:current', initial);
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  };
}

function context(options: { body?: unknown; token?: string; kv?: ReturnType<typeof makeKv> } = {}) {
  const kv = options.kv ?? makeKv();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  return {
    request: new Request('https://thesuperhuman.us/api/work-feed', {
      method: options.body === undefined ? 'GET' : 'POST',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    locals: {
      runtime: {
        env: {
          WORK_FEED: kv,
          WORK_FEED_INGEST_TOKEN: 'ingest-secret',
          WORK_FEED_ALLOWED_PROJECTS: 'threadline',
        },
      },
    },
  } as any;
}

describe('POST /api/work-feed', () => {
  it('publishes an authorized allowlisted update', async () => {
    const kv = makeKv();
    const response = await POST(context({ body: update, token: 'ingest-secret', kv }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, revision: 3 });
    expect(kv.put).toHaveBeenCalledOnce();
  });

  it('rejects missing credentials', async () => {
    const response = await POST(context({ body: update }));
    expect(response.status).toBe(401);
  });

  it('rejects projects outside the publication allowlist', async () => {
    const response = await POST(context({
      body: { ...update, projectId: 'private-project' },
      token: 'ingest-secret',
    }));
    expect(response.status).toBe(403);
  });

  it('rejects delayed or duplicate revisions', async () => {
    const kv = makeKv(JSON.stringify({ ...update, revision: 4 }));
    const response = await POST(context({ body: update, token: 'ingest-secret', kv }));
    expect(response.status).toBe(409);
    expect(kv.put).not.toHaveBeenCalled();
  });
});

describe('GET /api/work-feed', () => {
  it('returns the current public update without caching it', async () => {
    const kv = makeKv(JSON.stringify(update));
    const response = await GET(context({ kv }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ update });
  });

  it('returns null when no update has been published', async () => {
    const response = await GET(context());
    expect(await response.json()).toEqual({ update: null });
  });
});
