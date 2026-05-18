# audio.thesuperhuman.us Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `audio.thesuperhuman.us` as a second public site sharing the existing Astro project, with portfolio (grouped by service), about content, and an approval-free audio inquiry form, all routed via hostname-aware Astro middleware.

**Architecture:** One Astro project, one Cloudflare Worker. New `src/middleware.ts` inspects the `Host` header and internally rewrites non-API paths by prepending `/audio` for the audio host. New audio pages live at `src/pages/audio/*`. A new R2 bucket bound as `AUDIO` stores track files, served via a slug-validated streaming endpoint with `Range` support. The booking form reuses the existing Turnstile + rate-limit + Resend infrastructure with its own validation, template, and endpoint.

**Tech Stack:** Astro 5, TypeScript (strict), Tailwind CSS, Cloudflare Workers + Static Assets, R2, KV, Resend, Turnstile, Vitest.

**Spec reference:** `docs/superpowers/specs/2026-05-17-audio-subdomain-design.md`

**Key implementation decision:** Astro middleware reliably fires only on server-rendered routes. To make the host-based rewrite work for the audio host's `/`, the existing `src/pages/index.astro` and `src/pages/about.astro` must opt out of prerendering (`export const prerender = false`). New audio pages also opt out. Edge caching offsets the server-rendering cost.

---

## File Structure

**New files**

- `src/middleware.ts` — Astro middleware entry, calls into the routing helper.
- `src/lib/host-routing.ts` — pure function mapping `(host, pathname)` → rewritten pathname.
- `src/lib/audio-tracks.ts` — pure helpers for grouping tracks by service.
- `src/lib/audio-validation.ts` — input validation for the audio inquiry form.
- `src/lib/audio-resend.ts` — Resend payload for audio inquiries.
- `src/content/audio-tracks/` — directory holding one YAML file per track.
- `src/pages/audio/index.astro` — audio landing page (hero + portfolio + form).
- `src/pages/audio/about.astro` — longer-form about page.
- `src/pages/audio/file/[slug].ts` — R2 streaming endpoint.
- `src/pages/api/audio-inquiry.ts` — booking POST endpoint.
- `src/components/audio/AudioHero.astro`
- `src/components/audio/TrackRow.astro`
- `src/components/audio/ServiceSection.astro`
- `src/components/audio/BookingForm.astro`
- `src/components/audio/AudioFooter.astro`
- `src/scripts/audio-player-coordinator.ts` — pauses other audio elements on play.
- `scripts/upload-audio.mjs` — wrapper around `wrangler r2 object put`.
- `tests/lib/host-routing.test.ts`
- `tests/lib/audio-tracks.test.ts`
- `tests/lib/audio-validation.test.ts`
- `tests/lib/audio-resend.test.ts`
- `tests/api/audio-inquiry.test.ts`
- `tests/api/audio-file.test.ts`
- `tests/middleware.test.ts`

**Modified files**

- `wrangler.jsonc` — add `AUDIO` R2 binding and `audio.thesuperhuman.us/*` route entry.
- `src/env.d.ts` — add `AUDIO: R2Bucket` to `Env`.
- `src/content/config.ts` — register `audio-tracks` collection.
- `src/pages/index.astro` — add `export const prerender = false`.
- `src/pages/about.astro` — add `export const prerender = false`.
- `package.json` — add `audio:upload` npm script.

---

### Task 1: wrangler.jsonc — add R2 binding and audio host route

**Files:**
- Modify: `wrangler.jsonc`

- [ ] **Step 1: Add the AUDIO R2 binding and audio host route to wrangler.jsonc**

Open `wrangler.jsonc` and add `r2_buckets` (new top-level key) and `routes` entries. The full edit is two additions:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "thesuperhuman-us",
  "main": "./dist/_worker.js/index.js",
  "compatibility_date": "2026-05-14",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "binding": "ASSETS",
    "directory": "./dist"
  },
  "observability": {
    "enabled": true
  },
  "routes": [
    { "pattern": "thesuperhuman.us/*", "zone_name": "thesuperhuman.us" },
    { "pattern": "www.thesuperhuman.us/*", "zone_name": "thesuperhuman.us" },
    { "pattern": "audio.thesuperhuman.us/*", "zone_name": "thesuperhuman.us" }
  ],
  "vars": {
    "CONTACT_TO_EMAIL": "kazon.wilson@thesuperhuman.us",
    "CONTACT_FROM_EMAIL": "noreply@notifs.thesuperhuman.us",
    "PUBLIC_TURNSTILE_SITE_KEY": "0x4AAAAAADPYWKMQT_mbi4O-"
  },
  "kv_namespaces": [
    { "binding": "RATE_LIMIT", "id": "7410b0879b584637b83be68849e7c8e9" },
    { "binding": "RESUME_STORE", "id": "7410b0879b584637b83be68849e7c8e9" },
    { "binding": "SESSION", "id": "7410b0879b584637b83be68849e7c8e9" }
  ],
  "r2_buckets": [
    { "binding": "AUDIO", "bucket_name": "superhuman-audio" }
  ]
}
```

Note: keep any existing comments in `wrangler.jsonc` that are not shown above; the file format is JSON-with-comments. Do not delete inline comments.

- [ ] **Step 2: Commit**

```bash
git add wrangler.jsonc
git commit -m "wrangler: bind AUDIO R2 bucket and add audio.thesuperhuman.us route"
```

---

### Task 2: env.d.ts — add AUDIO binding type

**Files:**
- Modify: `src/env.d.ts`

- [ ] **Step 1: Add `AUDIO: R2Bucket` to the Env interface**

Edit `src/env.d.ts`. Add the `AUDIO` field to the existing `Env` interface:

```ts
interface Env {
  RESEND_API_KEY: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  CONTACT_TO_EMAIL: string;
  CONTACT_FROM_EMAIL: string;
  RATE_LIMIT: KVNamespace;
  RESUME_STORE: KVNamespace;
  AUDIO: R2Bucket;
}
```

- [ ] **Step 2: Verify the type compiles**

Run: `npx astro check`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/env.d.ts
git commit -m "env.d.ts: declare AUDIO R2 binding"
```

---

### Task 3: Content collection schema for audio tracks

**Files:**
- Modify: `src/content/config.ts`
- Create: `src/content/audio-tracks/.gitkeep`

- [ ] **Step 1: Add the audio-tracks collection definition**

Edit `src/content/config.ts`. The full file after edit:

```ts
import { defineCollection, z } from 'astro:content';

const pages = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

const notes = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const audioTracks = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string().min(1),
    artist: z.string().min(1),
    year: z.number().int().min(1900).max(2100),
    role: z.array(z.enum(['mix', 'master', 'produce', 'record'])).min(1),
    primaryService: z.enum(['mixing', 'mastering', 'production', 'recording']),
    notes: z.string().min(1),
    file: z.string().regex(/^tracks\/[a-z0-9-]+\.mp3$/),
    length: z.string().regex(/^\d{1,2}:\d{2}$/),
    featured: z.boolean().default(false),
    order: z.number().int().default(100),
  }),
});

export const collections = { pages, notes, 'audio-tracks': audioTracks };
```

- [ ] **Step 2: Create the audio-tracks directory placeholder**

```bash
mkdir -p src/content/audio-tracks
touch src/content/audio-tracks/.gitkeep
```

- [ ] **Step 3: Run type check**

Run: `npx astro check`
Expected: zero errors. Astro generates content collection types; an empty collection compiles fine.

- [ ] **Step 4: Commit**

```bash
git add src/content/config.ts src/content/audio-tracks/.gitkeep
git commit -m "content: add audio-tracks YAML collection schema"
```

---

### Task 4: host-routing helper (pure function)

**Files:**
- Create: `src/lib/host-routing.ts`
- Test: `tests/lib/host-routing.test.ts`

The helper is a pure function so it can be unit-tested without faking Astro context.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/host-routing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rewritePathForHost } from '~/lib/host-routing';

describe('rewritePathForHost', () => {
  it('returns null for the software host', () => {
    expect(rewritePathForHost('thesuperhuman.us', '/')).toBeNull();
    expect(rewritePathForHost('thesuperhuman.us', '/about')).toBeNull();
    expect(rewritePathForHost('www.thesuperhuman.us', '/')).toBeNull();
  });

  it('prepends /audio for the audio host root', () => {
    expect(rewritePathForHost('audio.thesuperhuman.us', '/')).toBe('/audio/');
  });

  it('prepends /audio for audio host pages', () => {
    expect(rewritePathForHost('audio.thesuperhuman.us', '/about')).toBe('/audio/about');
    expect(rewritePathForHost('audio.thesuperhuman.us', '/file/slow-burn')).toBe('/audio/file/slow-burn');
  });

  it('does not rewrite API paths on the audio host', () => {
    expect(rewritePathForHost('audio.thesuperhuman.us', '/api/contact')).toBeNull();
    expect(rewritePathForHost('audio.thesuperhuman.us', '/api/audio-inquiry')).toBeNull();
  });

  it('does not rewrite already-prefixed paths', () => {
    expect(rewritePathForHost('audio.thesuperhuman.us', '/audio/')).toBeNull();
    expect(rewritePathForHost('audio.thesuperhuman.us', '/audio/about')).toBeNull();
  });

  it('strips the port from the host before matching', () => {
    expect(rewritePathForHost('audio.thesuperhuman.us:443', '/')).toBe('/audio/');
  });

  it('is case-insensitive on host matching', () => {
    expect(rewritePathForHost('AUDIO.thesuperhuman.us', '/')).toBe('/audio/');
  });

  it('returns null for unknown hosts', () => {
    expect(rewritePathForHost('example.com', '/')).toBeNull();
    expect(rewritePathForHost('localhost:4321', '/')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- tests/lib/host-routing.test.ts`
Expected: FAIL with "Cannot find module '~/lib/host-routing'" or similar.

- [ ] **Step 3: Implement the helper**

Create `src/lib/host-routing.ts`:

```ts
const AUDIO_HOST = 'audio.thesuperhuman.us';

/**
 * If the request should be internally rewritten, returns the new pathname.
 * Returns null if no rewrite is required (the original pathname should be used).
 */
export function rewritePathForHost(host: string, pathname: string): string | null {
  const hostNoPort = host.split(':')[0].toLowerCase();
  if (hostNoPort !== AUDIO_HOST) return null;

  if (pathname.startsWith('/api/')) return null;
  if (pathname === '/audio' || pathname.startsWith('/audio/')) return null;

  if (pathname === '/') return '/audio/';
  return `/audio${pathname}`;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- tests/lib/host-routing.test.ts`
Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/host-routing.ts tests/lib/host-routing.test.ts
git commit -m "host-routing: pure helper for host-based path rewrites"
```

---

### Task 5: Astro middleware

**Files:**
- Create: `src/middleware.ts`
- Test: `tests/middleware.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/middleware.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { onRequest } from '~/middleware';

function makeContext(url: string, hostHeader?: string) {
  const u = new URL(url);
  const headers = new Headers();
  if (hostHeader) headers.set('host', hostHeader);
  return {
    url: u,
    request: new Request(url, { headers }),
    rewrite: vi.fn(async (target: string | URL) => {
      const rewritten = typeof target === 'string' ? new URL(target, u) : target;
      return new Response('rewritten:' + rewritten.pathname, { status: 200 });
    }),
  } as any;
}

describe('middleware.onRequest', () => {
  it('passes through for the software host', async () => {
    const ctx = makeContext('https://thesuperhuman.us/', 'thesuperhuman.us');
    const next = vi.fn(async () => new Response('next', { status: 200 }));
    const res = await onRequest(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.rewrite).not.toHaveBeenCalled();
    expect(await res.text()).toBe('next');
  });

  it('rewrites root on the audio host', async () => {
    const ctx = makeContext('https://audio.thesuperhuman.us/', 'audio.thesuperhuman.us');
    const next = vi.fn(async () => new Response('next', { status: 200 }));
    await onRequest(ctx, next);
    expect(ctx.rewrite).toHaveBeenCalledWith('/audio/');
    expect(next).not.toHaveBeenCalled();
  });

  it('rewrites /about on the audio host', async () => {
    const ctx = makeContext('https://audio.thesuperhuman.us/about', 'audio.thesuperhuman.us');
    const next = vi.fn(async () => new Response('next', { status: 200 }));
    await onRequest(ctx, next);
    expect(ctx.rewrite).toHaveBeenCalledWith('/audio/about');
  });

  it('does not rewrite /api/* on the audio host', async () => {
    const ctx = makeContext('https://audio.thesuperhuman.us/api/audio-inquiry', 'audio.thesuperhuman.us');
    const next = vi.fn(async () => new Response('next', { status: 200 }));
    await onRequest(ctx, next);
    expect(ctx.rewrite).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('falls back to URL.host when the Host header is missing', async () => {
    const ctx = makeContext('https://audio.thesuperhuman.us/', undefined);
    const next = vi.fn(async () => new Response('next', { status: 200 }));
    await onRequest(ctx, next);
    expect(ctx.rewrite).toHaveBeenCalledWith('/audio/');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- tests/middleware.test.ts`
Expected: FAIL with "Cannot find module '~/middleware'".

- [ ] **Step 3: Implement the middleware**

Create `src/middleware.ts`:

```ts
import { defineMiddleware } from 'astro:middleware';
import { rewritePathForHost } from '~/lib/host-routing';

export const onRequest = defineMiddleware(async (context, next) => {
  const host = context.request.headers.get('host') ?? context.url.host;
  const rewritten = rewritePathForHost(host, context.url.pathname);
  if (rewritten) {
    return context.rewrite(rewritten);
  }
  return next();
});
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- tests/middleware.test.ts`
Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts tests/middleware.test.ts
git commit -m "middleware: host-aware path rewriting for audio.thesuperhuman.us"
```

---

### Task 6: Opt existing root pages out of prerendering

For the middleware rewrite to fire on `audio.thesuperhuman.us/` (which lands on the root route), the root route must be server-rendered. Same for `/about`. This is the minimal change needed for middleware to intercept.

**Files:**
- Modify: `src/pages/index.astro`
- Modify: `src/pages/about.astro`

- [ ] **Step 1: Add prerender opt-out to index.astro**

Open `src/pages/index.astro`. The file starts with `---\nimport BaseLayout from '~/layouts/BaseLayout.astro';`. Insert the prerender line directly after the opening `---`:

```astro
---
export const prerender = false;
import BaseLayout from '~/layouts/BaseLayout.astro';
```

- [ ] **Step 2: Add prerender opt-out to about.astro**

Open `src/pages/about.astro`. Add the same line at the top of the frontmatter:

```astro
---
export const prerender = false;
// ...existing imports remain
```

- [ ] **Step 3: Build and verify both pages still render**

Run: `npm run build`
Expected: build succeeds with no errors.

Run: `npm run preview` (then visit `http://localhost:4321/` and `/about` in a browser to spot-check). Stop the preview server with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.astro src/pages/about.astro
git commit -m "pages: opt index and about out of prerendering for host-aware middleware"
```

---

### Task 7: audio-tracks helper

**Files:**
- Create: `src/lib/audio-tracks.ts`
- Test: `tests/lib/audio-tracks.test.ts`

The helper groups tracks by `primaryService` and sorts by `order`. Pure function over an array; no Astro context required.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/audio-tracks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupTracksByService, type AudioTrack } from '~/lib/audio-tracks';

const sample: AudioTrack[] = [
  { slug: 'a', title: 'A', artist: 'X', year: 2024, role: ['mix'], primaryService: 'mixing', notes: 'n', file: 'tracks/a.mp3', length: '3:00', featured: false, order: 10 },
  { slug: 'b', title: 'B', artist: 'Y', year: 2024, role: ['master'], primaryService: 'mastering', notes: 'n', file: 'tracks/b.mp3', length: '3:00', featured: false, order: 10 },
  { slug: 'c', title: 'C', artist: 'X', year: 2023, role: ['mix'], primaryService: 'mixing', notes: 'n', file: 'tracks/c.mp3', length: '3:00', featured: false, order: 5 },
];

describe('groupTracksByService', () => {
  it('returns one entry per service in fixed order', () => {
    const groups = groupTracksByService(sample);
    expect(groups.map(g => g.service)).toEqual(['mixing', 'mastering', 'production', 'recording']);
  });

  it('places tracks under their primaryService only', () => {
    const groups = groupTracksByService(sample);
    expect(groups.find(g => g.service === 'mixing')?.tracks.map(t => t.slug)).toEqual(['c', 'a']);
    expect(groups.find(g => g.service === 'mastering')?.tracks.map(t => t.slug)).toEqual(['b']);
    expect(groups.find(g => g.service === 'production')?.tracks).toEqual([]);
    expect(groups.find(g => g.service === 'recording')?.tracks).toEqual([]);
  });

  it('sorts tracks within a service by order ascending then year descending', () => {
    const groups = groupTracksByService(sample);
    const mixing = groups.find(g => g.service === 'mixing')!;
    expect(mixing.tracks.map(t => t.slug)).toEqual(['c', 'a']);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- tests/lib/audio-tracks.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/audio-tracks.ts`:

```ts
export type AudioRole = 'mix' | 'master' | 'produce' | 'record';
export type AudioService = 'mixing' | 'mastering' | 'production' | 'recording';

export interface AudioTrack {
  slug: string;
  title: string;
  artist: string;
  year: number;
  role: AudioRole[];
  primaryService: AudioService;
  notes: string;
  file: string;
  length: string;
  featured: boolean;
  order: number;
}

export interface ServiceGroup {
  service: AudioService;
  tracks: AudioTrack[];
}

const SERVICE_ORDER: AudioService[] = ['mixing', 'mastering', 'production', 'recording'];

export function groupTracksByService(tracks: AudioTrack[]): ServiceGroup[] {
  return SERVICE_ORDER.map((service) => {
    const matching = tracks
      .filter((t) => t.primaryService === service)
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return b.year - a.year;
      });
    return { service, tracks: matching };
  });
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- tests/lib/audio-tracks.test.ts`
Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio-tracks.ts tests/lib/audio-tracks.test.ts
git commit -m "audio-tracks: helper for grouping tracks by service line"
```

---

### Task 8: R2 file streaming endpoint

**Files:**
- Create: `src/pages/audio/file/[slug].ts`
- Test: `tests/api/audio-file.test.ts`

Validates the slug against the content collection before reading R2 to prevent enumeration and arbitrary key reads.

- [ ] **Step 1: Write the failing test**

Create `tests/api/audio-file.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('astro:content', () => {
  return {
    getCollection: vi.fn(async () => [
      { id: 'slow-burn', data: { file: 'tracks/slow-burn.mp3' } },
    ]),
  };
});

import { GET } from '~/pages/audio/file/[slug]';

function makeR2(body = new Uint8Array([1, 2, 3, 4, 5]), size = 5) {
  return {
    get: vi.fn(async (_key: string, opts?: any) => {
      const range = opts?.range;
      if (range && range.offset !== undefined && range.length !== undefined) {
        const slice = body.slice(range.offset, range.offset + range.length);
        return {
          body: new Response(slice).body,
          size,
          range,
        };
      }
      return {
        body: new Response(body).body,
        size,
      };
    }),
  };
}

function makeContext(slug: string, rangeHeader?: string) {
  const headers = new Headers();
  if (rangeHeader) headers.set('range', rangeHeader);
  const audio = makeR2();
  return {
    params: { slug },
    request: new Request(`https://audio.thesuperhuman.us/file/${slug}`, { headers }),
    locals: { runtime: { env: { AUDIO: audio } } },
  } as any;
}

describe('GET /audio/file/[slug]', () => {
  it('streams the full file when no Range header is sent', async () => {
    const res = await GET(makeContext('slow-burn'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await GET(makeContext('unknown'));
    expect(res.status).toBe(404);
  });

  it('honours a Range header with 206 and Content-Range', async () => {
    const res = await GET(makeContext('slow-burn', 'bytes=1-3'));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 1-3/5');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- tests/api/audio-file.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the endpoint**

Create `src/pages/audio/file/[slug].ts`:

```ts
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const prerender = false;

function parseRangeHeader(header: string | null, size: number): { offset: number; length: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) return null;
  return { offset: start, length: end - start + 1 };
}

export const GET: APIRoute = async (context) => {
  const slug = context.params.slug;
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) {
    return new Response('not found', { status: 404 });
  }

  const collection = await getCollection('audio-tracks');
  const entry = collection.find((e) => e.id === slug);
  if (!entry) return new Response('not found', { status: 404 });

  const env = (context.locals as any).runtime.env as Env;
  const key = (entry.data as any).file as string;

  const rangeHeader = context.request.headers.get('range');
  // First fetch without range to know total size.
  const head = await env.AUDIO.get(key);
  if (!head) return new Response('not found', { status: 404 });
  const size = head.size;

  const range = parseRangeHeader(rangeHeader, size);

  if (range) {
    const partial = await env.AUDIO.get(key, { range: { offset: range.offset, length: range.length } });
    if (!partial) return new Response('not found', { status: 404 });
    return new Response(partial.body, {
      status: 206,
      headers: {
        'content-type': 'audio/mpeg',
        'accept-ranges': 'bytes',
        'content-range': `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`,
        'content-length': String(range.length),
        'cache-control': 'public, max-age=31536000, immutable',
        'content-disposition': `inline; filename="${slug}.mp3"`,
      },
    });
  }

  return new Response(head.body, {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      'accept-ranges': 'bytes',
      'content-length': String(size),
      'cache-control': 'public, max-age=31536000, immutable',
      'content-disposition': `inline; filename="${slug}.mp3"`,
    },
  });
};
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- tests/api/audio-file.test.ts`
Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/audio/file/[slug].ts tests/api/audio-file.test.ts
git commit -m "audio file endpoint: R2 streaming with slug validation and Range support"
```

---

### Task 9: Audio inquiry validation

**Files:**
- Create: `src/lib/audio-validation.ts`
- Test: `tests/lib/audio-validation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/audio-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateAudioInquiry } from '~/lib/audio-validation';

const valid = {
  name: 'Jane',
  email: 'jane@example.com',
  services: ['mixing'],
  trackCount: 3,
  targetDate: '2026-08-01',
  flexible: false,
  references: 'https://example.com/ref',
  delivery: 'Dropbox',
  notes: 'A long enough description of the project that gives me real context to plan around.',
  turnstileToken: 'tok',
};

describe('validateAudioInquiry', () => {
  it('accepts a fully-valid payload', () => {
    const r = validateAudioInquiry(valid);
    expect(r.ok).toBe(true);
  });

  it('requires at least one service', () => {
    const r = validateAudioInquiry({ ...valid, services: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.services).toBeDefined();
  });

  it('rejects unknown service values', () => {
    const r = validateAudioInquiry({ ...valid, services: ['hypnosis'] });
    expect(r.ok).toBe(false);
  });

  it('requires a delivery method from the allowlist', () => {
    const r = validateAudioInquiry({ ...valid, delivery: 'CarrierPigeon' });
    expect(r.ok).toBe(false);
  });

  it('treats targetDate as optional when flexible is true', () => {
    const r = validateAudioInquiry({ ...valid, targetDate: '', flexible: true });
    expect(r.ok).toBe(true);
  });

  it('rejects too-short notes', () => {
    const r = validateAudioInquiry({ ...valid, notes: 'too short' });
    expect(r.ok).toBe(false);
  });

  it('rejects missing email', () => {
    const r = validateAudioInquiry({ ...valid, email: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects missing turnstile token', () => {
    const r = validateAudioInquiry({ ...valid, turnstileToken: '' });
    expect(r.ok).toBe(false);
  });

  it('coerces trackCount=null to undefined and accepts', () => {
    const r = validateAudioInquiry({ ...valid, trackCount: null });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- tests/lib/audio-validation.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the validator**

Create `src/lib/audio-validation.ts`:

```ts
export const AUDIO_SERVICES = ['mixing', 'mastering', 'production', 'recording'] as const;
export type AudioServiceChoice = (typeof AUDIO_SERVICES)[number];

export const DELIVERY_METHODS = ['Google Drive', 'Dropbox', 'WeTransfer', 'Other'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export type AudioInquiryInput = {
  name: string;
  email: string;
  services: AudioServiceChoice[];
  trackCount?: number;
  targetDate?: string;
  flexible: boolean;
  references?: string;
  delivery: DeliveryMethod;
  notes: string;
  turnstileToken: string;
};

export type AudioValidationResult =
  | { ok: true; value: AudioInquiryInput }
  | { ok: false; errors: Record<string, string> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateAudioInquiry(input: unknown): AudioValidationResult {
  const errors: Record<string, string> = {};
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: { _form: 'Invalid request body.' } };
  }
  const v = input as Record<string, unknown>;

  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!name) errors.name = 'Name is required.';
  else if (name.length > 100) errors.name = 'Name is too long.';

  const email = typeof v.email === 'string' ? v.email.trim() : '';
  if (!email) errors.email = 'Email is required.';
  else if (email.length > 120 || !EMAIL_RE.test(email)) errors.email = 'Invalid email.';

  const services = Array.isArray(v.services)
    ? v.services.filter((s): s is string => typeof s === 'string')
    : [];
  if (services.length === 0) {
    errors.services = 'Pick at least one service.';
  } else if (!services.every((s) => (AUDIO_SERVICES as readonly string[]).includes(s))) {
    errors.services = 'Unknown service.';
  }

  let trackCount: number | undefined = undefined;
  if (v.trackCount !== null && v.trackCount !== undefined && v.trackCount !== '') {
    const n = typeof v.trackCount === 'number' ? v.trackCount : parseInt(String(v.trackCount), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 1000) trackCount = n;
    else errors.trackCount = 'Track count must be a positive integer.';
  }

  const flexible = v.flexible === true;
  let targetDate: string | undefined = undefined;
  if (typeof v.targetDate === 'string' && v.targetDate.trim()) {
    if (!DATE_RE.test(v.targetDate.trim())) {
      errors.targetDate = 'Use YYYY-MM-DD.';
    } else {
      targetDate = v.targetDate.trim();
    }
  } else if (!flexible) {
    // either a date or "flexible" is required
    errors.targetDate = 'Pick a date or check "flexible".';
  }

  const references = typeof v.references === 'string' ? v.references.trim() : '';
  if (references.length > 2000) errors.references = 'Reference field is too long.';

  const delivery = typeof v.delivery === 'string' ? v.delivery.trim() : '';
  if (!(DELIVERY_METHODS as readonly string[]).includes(delivery)) {
    errors.delivery = 'Pick a delivery method.';
  }

  const notes = typeof v.notes === 'string' ? v.notes.trim() : '';
  if (notes.length < 40) errors.notes = 'Please write at least 40 characters.';
  else if (notes.length > 4000) errors.notes = 'Description is too long.';

  const turnstileToken = typeof v.turnstileToken === 'string' ? v.turnstileToken : '';
  if (!turnstileToken) errors.turnstileToken = 'Captcha missing.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      email,
      services: services as AudioServiceChoice[],
      trackCount,
      targetDate,
      flexible,
      references: references || undefined,
      delivery: delivery as DeliveryMethod,
      notes,
      turnstileToken,
    },
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- tests/lib/audio-validation.test.ts`
Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio-validation.ts tests/lib/audio-validation.test.ts
git commit -m "audio-validation: validator for booking form inputs"
```

---

### Task 10: Audio Resend payload helper

**Files:**
- Create: `src/lib/audio-resend.ts`
- Test: `tests/lib/audio-resend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/audio-resend.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendAudioInquiry } from '~/lib/audio-resend';
import type { AudioInquiryInput } from '~/lib/audio-validation';

const input: AudioInquiryInput = {
  name: 'Jane',
  email: 'jane@example.com',
  services: ['mixing', 'mastering'],
  trackCount: 3,
  targetDate: '2026-08-01',
  flexible: false,
  references: 'https://example.com/ref',
  delivery: 'Dropbox',
  notes: 'Long enough description of the project that explains the work clearly.',
  turnstileToken: 'tok',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'em_1' }) } as any)));
});

describe('sendAudioInquiry', () => {
  it('posts to Resend with the expected payload', async () => {
    const res = await sendAudioInquiry({ input, apiKey: 'k', from: 'noreply@notifs.x', to: 'kazon@x' });
    expect(res.ok).toBe(true);
    const calls = (fetch as any).mock.calls;
    expect(calls.length).toBe(1);
    const body = JSON.parse(calls[0][1].body);
    expect(body.from).toBe('noreply@notifs.x');
    expect(body.to).toEqual(['kazon@x']);
    expect(body.subject).toContain('Audio inquiry');
    expect(body.subject).toContain('Jane');
    expect(body.subject).toContain('mixing');
    expect(body.text).toContain('Services: mixing, mastering');
    expect(body.text).toContain('Track count: 3');
    expect(body.text).toContain('Target date: 2026-08-01');
    expect(body.text).toContain('Delivery: Dropbox');
    expect(body.reply_to).toBe('jane@example.com');
  });

  it('reports failure when Resend returns non-ok', async () => {
    (fetch as any).mockImplementation(async () => ({ ok: false, json: async () => ({}) } as any));
    const res = await sendAudioInquiry({ input, apiKey: 'k', from: 'noreply@notifs.x', to: 'kazon@x' });
    expect(res.ok).toBe(false);
  });

  it('renders "flexible" when no target date is set', async () => {
    (fetch as any).mockImplementation(async () => ({ ok: true } as any));
    const flex: AudioInquiryInput = { ...input, targetDate: undefined, flexible: true };
    await sendAudioInquiry({ input: flex, apiKey: 'k', from: 'a', to: 'b' });
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.text).toContain('Target date: flexible');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- tests/lib/audio-resend.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/audio-resend.ts`:

```ts
import type { AudioInquiryInput } from './audio-validation';

const ENDPOINT = 'https://api.resend.com/emails';

interface SendArgs {
  input: AudioInquiryInput;
  apiKey: string;
  from: string;
  to: string;
}

function body(input: AudioInquiryInput): string {
  const lines = [
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Services: ${input.services.join(', ')}`,
    input.trackCount !== undefined ? `Track count: ${input.trackCount}` : null,
    `Target date: ${input.flexible || !input.targetDate ? 'flexible' : input.targetDate}`,
    `Delivery: ${input.delivery}`,
    input.references ? `References: ${input.references}` : null,
    '',
    'Notes:',
    input.notes,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export async function sendAudioInquiry(args: SendArgs): Promise<{ ok: boolean }> {
  const payload = {
    from: args.from,
    to: [args.to],
    subject: `Audio inquiry: ${args.input.services.join(', ')} from ${args.input.name}`,
    text: body(args.input),
    reply_to: args.input.email,
  };
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- tests/lib/audio-resend.test.ts`
Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio-resend.ts tests/lib/audio-resend.test.ts
git commit -m "audio-resend: Resend email payload for audio inquiries"
```

---

### Task 11: Audio inquiry API endpoint

**Files:**
- Create: `src/pages/api/audio-inquiry.ts`
- Test: `tests/api/audio-inquiry.test.ts`

Mirrors the existing `/api/contact` flow: origin check, validate, rate-limit (KV prefix `rl:audio:`), Turnstile, send.

- [ ] **Step 1: Write the failing test**

Create `tests/api/audio-inquiry.test.ts`:

```ts
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
    expect((await res.json()).ok).toBe(true);
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
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- tests/api/audio-inquiry.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the endpoint**

Create `src/pages/api/audio-inquiry.ts`:

```ts
import type { APIRoute } from 'astro';
import { validateAudioInquiry } from '~/lib/audio-validation';
import { verifyTurnstile } from '~/lib/turnstile';
import { sendAudioInquiry } from '~/lib/audio-resend';
import type { KvLike } from '~/lib/rate-limit';

export const prerender = false;

const ALLOWED_ORIGINS = [
  'https://thesuperhuman.us',
  'https://www.thesuperhuman.us',
  'https://audio.thesuperhuman.us',
];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.thesuperhuman-us\.pages\.dev$/.test(origin)) return true;
  return false;
}

const WINDOW_SECONDS = 300;

async function checkAudioRateLimit(kv: KvLike, ip: string): Promise<{ allowed: boolean }> {
  const key = `rl:audio:${ip}`;
  const existing = await kv.get(key);
  if (existing) return { allowed: false };
  await kv.put(key, '1', { expirationTtl: WINDOW_SECONDS });
  return { allowed: true };
}

export const POST: APIRoute = async (context) => {
  const { request, locals } = context;
  const env = (locals as any).runtime.env as Env;

  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const validation = validateAudioInquiry(body);
  if (!validation.ok) {
    return Response.json({ ok: false, errors: validation.errors }, { status: 400 });
  }
  const input = validation.value;

  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  const rl = await checkAudioRateLimit(env.RATE_LIMIT, ip);
  if (!rl.allowed) {
    return Response.json(
      { ok: false, error: 'Please wait a few minutes before submitting again.' },
      { status: 429 },
    );
  }

  const turnstileOk = await verifyTurnstile(input.turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
  if (!turnstileOk) {
    return Response.json({ ok: false, error: 'Captcha failed.' }, { status: 403 });
  }

  const send = await sendAudioInquiry({
    input,
    apiKey: env.RESEND_API_KEY,
    from: env.CONTACT_FROM_EMAIL,
    to: env.CONTACT_TO_EMAIL,
  });
  if (!send.ok) {
    return Response.json(
      { ok: false, error: 'Email delivery failed. Please email kazon.wilson@thesuperhuman.us directly.' },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
};
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- tests/api/audio-inquiry.test.ts`
Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/audio-inquiry.ts tests/api/audio-inquiry.test.ts
git commit -m "audio-inquiry API: validate, rate-limit, Turnstile-verify, Resend"
```

---

### Task 12: AudioFooter component

**Files:**
- Create: `src/components/audio/AudioFooter.astro`

- [ ] **Step 1: Implement the component**

Create `src/components/audio/AudioFooter.astro`:

```astro
---
const year = new Date().getFullYear();
---
<footer class="border-t border-rule mt-24">
  <div class="mx-auto max-w-page px-6 py-12">
    <div class="grid gap-8 md:grid-cols-3 text-sm text-muted">
      <div>
        <div class="eyebrow mb-3">Contact</div>
        <p>
          <a href="mailto:kazon.wilson@thesuperhuman.us" style="color: var(--ink);">kazon.wilson@thesuperhuman.us</a>
        </p>
        <p class="mt-1">Northern Virginia</p>
      </div>
      <div>
        <div class="eyebrow mb-3">Also</div>
        <ul class="space-y-1">
          <li>
            <a href="https://thesuperhuman.us" style="color: var(--ink);">Software engineering at thesuperhuman.us</a>
          </li>
        </ul>
      </div>
      <div>
        <div class="eyebrow mb-3">Identity</div>
        <p>The Superhuman Group LLC</p>
        <p class="mt-1">© {year}</p>
      </div>
    </div>
  </div>
</footer>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/audio/AudioFooter.astro
git commit -m "AudioFooter: footer variant with cross-site link to software side"
```

---

### Task 13: AudioHero component

**Files:**
- Create: `src/components/audio/AudioHero.astro`

- [ ] **Step 1: Implement the component**

Create `src/components/audio/AudioHero.astro`:

```astro
---
---
<section class="mx-auto max-w-page px-6 pt-16 pb-20 md:pt-24 md:pb-28">
  <div class="max-w-measure">
    <div class="eyebrow flex items-center gap-2 mb-9">
      <span class="inline-block w-1.5 h-1.5 rounded-full" style="background: var(--accent);"></span>
      Available for audio engagements · 2026
    </div>

    <h1 class="display mb-5">Mixing, mastering, and production from a working engineer.</h1>

    <p class="lede mb-4" style="color: #2a2a2a;">
      Independent and label-affiliated artists. Fixed-price project work, async delivery.
    </p>

    <p class="text-base text-muted mb-8">
      Audio engineering through The Superhuman Group LLC.
    </p>

    <div class="flex flex-wrap gap-4 items-center">
      <a href="#book" class="btn-primary" style="border-bottom: none;">Book a project</a>
      <a href="/about" class="text-base">Read more →</a>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/audio/AudioHero.astro
git commit -m "AudioHero: landing hero for audio.thesuperhuman.us"
```

---

### Task 14: TrackRow component

**Files:**
- Create: `src/components/audio/TrackRow.astro`

- [ ] **Step 1: Implement the component**

Create `src/components/audio/TrackRow.astro`:

```astro
---
import type { AudioRole, AudioTrack } from '~/lib/audio-tracks';
interface Props {
  track: AudioTrack;
}
const { track } = Astro.props;
const ROLE_LABEL: Record<AudioRole, string> = {
  mix: 'Mixed',
  master: 'Mastered',
  produce: 'Produced',
  record: 'Recorded',
};
const roleText = track.role.map((r) => ROLE_LABEL[r]).join(', ');
const src = `/file/${track.slug}`;
---
<article class="track-row py-5 border-b border-rule">
  <div class="flex items-baseline gap-3 mb-2">
    <h3 class="text-lg font-medium">{track.title}</h3>
    <span class="text-sm text-muted">— {track.artist}</span>
  </div>
  <p class="eyebrow mb-3">{track.year} · {track.length} · {roleText}</p>
  <audio
    class="audio-player w-full"
    controls
    preload="none"
    controlslist="nodownload"
    src={src}
  ></audio>
  <p class="text-sm mt-3 max-w-measure" style="color: var(--muted);">{track.notes}</p>
</article>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/audio/TrackRow.astro
git commit -m "TrackRow: one-track portfolio row with inline player"
```

---

### Task 15: ServiceSection component

**Files:**
- Create: `src/components/audio/ServiceSection.astro`

- [ ] **Step 1: Implement the component**

Create `src/components/audio/ServiceSection.astro`:

```astro
---
import TrackRow from './TrackRow.astro';
import type { AudioService, AudioTrack } from '~/lib/audio-tracks';

interface Props {
  service: AudioService;
  tracks: AudioTrack[];
}
const { service, tracks } = Astro.props;

const SERVICE_META: Record<AudioService, { label: string; cta: string; copy: string }> = {
  mixing: {
    label: 'Mixing',
    cta: 'Book a mixing engagement',
    copy: 'Multitrack stems in, polished mix out. Fixed-price per song.',
  },
  mastering: {
    label: 'Mastering',
    cta: 'Book a mastering engagement',
    copy: 'Final loudness, EQ, and translation pass on a finished mix.',
  },
  production: {
    label: 'Production',
    cta: 'Talk about a production project',
    copy: 'Songwriting, arrangement, instrumentation, and programming. Longer engagements.',
  },
  recording: {
    label: 'Recording',
    cta: 'Book a recording session',
    copy: 'Remote-managed tracking. Artist records to spec, sends takes, I comp and prep.',
  },
};

const meta = SERVICE_META[service];
---
<section class="mx-auto max-w-content px-6 py-16 md:py-20 border-t border-rule">
  <div class="flex flex-wrap items-baseline gap-4 mb-3">
    <h2 class="heading">{meta.label}</h2>
    <a href="#book" class="eyebrow" style="color: var(--accent); border-bottom: 1px solid var(--accent); padding-bottom: 1px;">{meta.cta} →</a>
  </div>
  <p class="text-base text-muted max-w-measure mb-8">{meta.copy}</p>
  {tracks.length === 0 ? (
    <p class="text-sm text-muted italic">More examples coming.</p>
  ) : (
    <div>
      {tracks.map((t) => <TrackRow track={t} />)}
    </div>
  )}
</section>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/audio/ServiceSection.astro
git commit -m "ServiceSection: service heading, CTA, and grouped TrackRows"
```

---

### Task 16: Audio player coordinator script

**Files:**
- Create: `src/scripts/audio-player-coordinator.ts`

- [ ] **Step 1: Implement the script**

Create `src/scripts/audio-player-coordinator.ts`:

```ts
// Pauses other <audio> elements when one starts playing.
// Loaded as a module via <script type="module"> from the landing page.

const players = Array.from(document.querySelectorAll<HTMLAudioElement>('audio.audio-player'));
for (const player of players) {
  player.addEventListener('play', () => {
    for (const other of players) {
      if (other !== player && !other.paused) {
        other.pause();
      }
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/audio-player-coordinator.ts
git commit -m "audio-player-coordinator: pause other players on play"
```

---

### Task 17: BookingForm component

**Files:**
- Create: `src/components/audio/BookingForm.astro`

The form is rendered server-side; submission is handled client-side and POSTs to `/api/audio-inquiry`. Pattern mirrors `src/components/ContactForm.astro`.

- [ ] **Step 1: Implement the component**

Create `src/components/audio/BookingForm.astro`:

```astro
---
import { AUDIO_SERVICES, DELIVERY_METHODS } from '~/lib/audio-validation';
const turnstileSiteKey = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? '';
---
<form id="audio-form" class="space-y-6 max-w-content" novalidate>
  <noscript>
    <p class="text-sm" style="color: var(--accent);">
      This form requires JavaScript. Email
      <a href="mailto:kazon.wilson@thesuperhuman.us">kazon.wilson@thesuperhuman.us</a>
      directly.
    </p>
  </noscript>

  <div class="grid gap-5 md:grid-cols-2">
    <div>
      <label class="eyebrow block mb-2" for="af-name">Name</label>
      <input id="af-name" name="name" type="text" required maxlength="100" class="w-full border border-rule bg-paper px-3 py-2 text-base rounded-sm focus:outline-none focus:border-accent" />
      <p class="af-error text-sm mt-1 hidden" data-field="name" style="color: var(--accent);"></p>
    </div>
    <div>
      <label class="eyebrow block mb-2" for="af-email">Email</label>
      <input id="af-email" name="email" type="email" required maxlength="120" class="w-full border border-rule bg-paper px-3 py-2 text-base rounded-sm focus:outline-none focus:border-accent" />
      <p class="af-error text-sm mt-1 hidden" data-field="email" style="color: var(--accent);"></p>
    </div>
  </div>

  <fieldset>
    <legend class="eyebrow mb-3">Service interest</legend>
    <div class="flex flex-wrap gap-2">
      {AUDIO_SERVICES.map((s) => (
        <label class="af-chip cursor-pointer">
          <input type="checkbox" name="services" value={s} class="sr-only peer" />
          <span class="inline-block border border-rule px-3 py-1.5 text-sm rounded-full capitalize peer-checked:bg-ink peer-checked:text-paper peer-checked:border-ink">
            {s}
          </span>
        </label>
      ))}
    </div>
    <p class="af-error text-sm mt-2 hidden" data-field="services" style="color: var(--accent);"></p>
  </fieldset>

  <div class="grid gap-5 md:grid-cols-2">
    <div>
      <label class="eyebrow block mb-2" for="af-tracks">Number of tracks <span class="text-muted normal-case tracking-normal">(optional)</span></label>
      <input id="af-tracks" name="trackCount" type="number" min="1" max="1000" class="w-full border border-rule bg-paper px-3 py-2 text-base rounded-sm focus:outline-none focus:border-accent" />
      <p class="af-error text-sm mt-1 hidden" data-field="trackCount" style="color: var(--accent);"></p>
    </div>
    <div>
      <label class="eyebrow block mb-2" for="af-date">Target delivery date</label>
      <input id="af-date" name="targetDate" type="date" class="w-full border border-rule bg-paper px-3 py-2 text-base rounded-sm focus:outline-none focus:border-accent" />
      <label class="inline-flex items-center gap-2 mt-2 text-sm">
        <input type="checkbox" name="flexible" /> Flexible
      </label>
      <p class="af-error text-sm mt-1 hidden" data-field="targetDate" style="color: var(--accent);"></p>
    </div>
  </div>

  <div>
    <label class="eyebrow block mb-2" for="af-references">Reference tracks <span class="text-muted normal-case tracking-normal">(optional)</span></label>
    <textarea id="af-references" name="references" rows={2} maxlength="2000" class="w-full border border-rule bg-paper px-3 py-2 text-base rounded-sm focus:outline-none focus:border-accent"></textarea>
  </div>

  <div>
    <label class="eyebrow block mb-2" for="af-delivery">File delivery method</label>
    <select id="af-delivery" name="delivery" required class="w-full border border-rule bg-paper px-3 py-2 text-base rounded-sm focus:outline-none focus:border-accent">
      <option value="">Pick one</option>
      {DELIVERY_METHODS.map((d) => <option value={d}>{d}</option>)}
    </select>
    <p class="af-error text-sm mt-1 hidden" data-field="delivery" style="color: var(--accent);"></p>
  </div>

  <div>
    <label class="eyebrow block mb-2" for="af-notes">Project notes</label>
    <textarea id="af-notes" name="notes" rows={5} required minlength="40" maxlength="4000" class="w-full border border-rule bg-paper px-3 py-2 text-base rounded-sm focus:outline-none focus:border-accent"></textarea>
    <p class="af-error text-sm mt-1 hidden" data-field="notes" style="color: var(--accent);"></p>
  </div>

  <div class="cf-turnstile" data-sitekey={turnstileSiteKey}></div>
  <p class="af-error text-sm mt-1 hidden" data-field="turnstileToken" style="color: var(--accent);"></p>

  <div>
    <button type="submit" class="btn-primary">Send inquiry</button>
    <p id="af-status" class="text-sm mt-3 hidden"></p>
  </div>
</form>

<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

<script>
  const form = document.getElementById('audio-form') as HTMLFormElement;
  const status = document.getElementById('af-status') as HTMLParagraphElement;

  function clearErrors() {
    form.querySelectorAll('.af-error').forEach((el) => {
      (el as HTMLElement).classList.add('hidden');
      el.textContent = '';
    });
  }

  function showErrors(errors: Record<string, string>) {
    for (const [field, message] of Object.entries(errors)) {
      const el = form.querySelector(`.af-error[data-field="${field}"]`) as HTMLElement | null;
      if (el) {
        el.textContent = message;
        el.classList.remove('hidden');
      }
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();

    const fd = new FormData(form);
    const services = fd.getAll('services').map(String);
    const trackCountStr = String(fd.get('trackCount') ?? '');
    const tokenInput = form.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement | null;
    const turnstileToken = tokenInput?.value ?? '';

    const payload = {
      name: String(fd.get('name') ?? ''),
      email: String(fd.get('email') ?? ''),
      services,
      trackCount: trackCountStr ? parseInt(trackCountStr, 10) : null,
      targetDate: String(fd.get('targetDate') ?? ''),
      flexible: fd.get('flexible') === 'on',
      references: String(fd.get('references') ?? ''),
      delivery: String(fd.get('delivery') ?? ''),
      notes: String(fd.get('notes') ?? ''),
      turnstileToken,
    };

    status.classList.remove('hidden');
    status.textContent = 'Sending…';
    status.style.color = 'var(--muted)';

    try {
      const res = await fetch('/api/audio-inquiry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok: boolean; errors?: Record<string, string>; error?: string };
      if (data.ok) {
        status.textContent = 'Thanks. I will respond within two business days.';
        status.style.color = 'var(--ink)';
        form.reset();
        (window as any).turnstile?.reset();
      } else if (data.errors) {
        showErrors(data.errors);
        status.textContent = 'Please fix the highlighted fields.';
        status.style.color = 'var(--accent)';
      } else {
        status.textContent = data.error ?? 'Something went wrong.';
        status.style.color = 'var(--accent)';
      }
    } catch {
      status.textContent = 'Network error. Please try again or email kazon.wilson@thesuperhuman.us directly.';
      status.style.color = 'var(--accent)';
    }
  });
</script>
```

- [ ] **Step 2: Type-check**

Run: `npx astro check`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/audio/BookingForm.astro
git commit -m "BookingForm: audio-specific approval-free contact form"
```

---

### Task 18: Audio landing page

**Files:**
- Create: `src/pages/audio/index.astro`

- [ ] **Step 1: Implement the page**

Create `src/pages/audio/index.astro`:

```astro
---
export const prerender = false;

import { getCollection } from 'astro:content';
import BaseLayout from '~/layouts/BaseLayout.astro';
import AudioHero from '~/components/audio/AudioHero.astro';
import ServiceSection from '~/components/audio/ServiceSection.astro';
import BookingForm from '~/components/audio/BookingForm.astro';
import AudioFooter from '~/components/audio/AudioFooter.astro';
import { groupTracksByService, type AudioTrack } from '~/lib/audio-tracks';

const entries = await getCollection('audio-tracks');
const tracks: AudioTrack[] = entries.map((e) => ({
  slug: e.id,
  ...(e.data as Omit<AudioTrack, 'slug'>),
}));
const groups = groupTracksByService(tracks);

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Kazon Wilson',
  jobTitle: 'Audio Engineer',
  url: 'https://audio.thesuperhuman.us',
  worksFor: { '@type': 'Organization', name: 'The Superhuman Group LLC' },
};
---
<BaseLayout
  title="Kazon Wilson · Audio engineering through The Superhuman Group LLC"
  description="Mixing, mastering, production, and recording. Fixed-price, async delivery."
  jsonLd={jsonLd}
>
  <AudioHero />

  <section class="mx-auto max-w-content px-6 py-12 border-t border-rule">
    <p class="text-[1.0625rem] leading-relaxed max-w-measure">
      I am a working audio engineer with an MTSU undergraduate degree in audio production. I take on mixing, mastering, production, and remote recording engagements for independent and label-affiliated artists. Engagements are fixed-price and project-scoped; communication is async-first.
    </p>
  </section>

  {groups.map((g) => <ServiceSection service={g.service} tracks={g.tracks} />)}

  <section id="book" class="mx-auto max-w-content px-6 py-16 md:py-20 border-t border-rule">
    <h2 class="heading mb-3">Book a project</h2>
    <p class="text-base text-muted mb-10 max-w-measure">
      Tell me about the project. I usually reply within two business days.
    </p>
    <BookingForm />
  </section>

  <script>
    import '~/scripts/audio-player-coordinator';
  </script>

  <AudioFooter slot="footer" />
</BaseLayout>
```

Astro bundles the imported TypeScript script as part of the page; no separate static `.js` asset is needed.

- [ ] **Step 2: Type-check and build**

Run: `npx astro check`
Expected: zero errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/audio/index.astro
git commit -m "audio landing: hero, intro, service sections, booking form"
```

---

### Task 19: Audio about page

**Files:**
- Create: `src/pages/audio/about.astro`

- [ ] **Step 1: Implement the page**

Create `src/pages/audio/about.astro`:

```astro
---
export const prerender = false;

import BaseLayout from '~/layouts/BaseLayout.astro';
import AudioFooter from '~/components/audio/AudioFooter.astro';
---
<BaseLayout
  title="About · Audio engineering at thesuperhuman.us"
  description="Kazon Wilson, audio engineer. Background, gear, workflow, revision policy."
>
  <section class="mx-auto max-w-content px-6 py-16 md:py-24">
    <p class="eyebrow mb-6">About</p>
    <h1 class="display mb-8">Audio engineering, plainly described.</h1>

    <div class="prose-about max-w-measure space-y-6 text-[1.0625rem] leading-relaxed">
      <p>
        I am Kazon Wilson, an audio engineer working through The Superhuman Group LLC, a Wyoming LLC I run for contract work. I studied audio production at MTSU and have been mixing and engineering since then. The engagements I take are project-scoped: mixing, mastering, remote-managed recording, and longer production work.
      </p>
      <p>
        Communication is async. Most projects start with a written brief, references, and stems delivered through Google Drive, Dropbox, or WeTransfer. I mix on a small treated room with an RME Babyface Pro and Sennheiser HD 650s, working in UAD Luna and Pro Tools, and check on three additional reference systems before delivery.
      </p>
      <p>
        I price per project, not per hour. The first round of revisions is included; subsequent rounds are scoped at the start. If a project is outside what I can do well, I will say so and recommend someone who can.
      </p>
      <p>
        Looking for the software-engineering side of The Superhuman Group? That lives at <a href="https://thesuperhuman.us" style="border-bottom: 1px solid var(--accent); padding-bottom: 1px;">thesuperhuman.us</a>.
      </p>
    </div>
  </section>

  <AudioFooter slot="footer" />
</BaseLayout>
```

- [ ] **Step 2: Type-check**

Run: `npx astro check`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/audio/about.astro
git commit -m "audio about: longer-form about page with cross-site link"
```

---

### Task 20: Upload helper script

**Files:**
- Create: `scripts/upload-audio.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the upload script**

Create `scripts/upload-audio.mjs`:

```js
#!/usr/bin/env node
import { basename } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [, , filePath] = process.argv;
if (!filePath) {
  console.error('Usage: npm run audio:upload <path/to/track.mp3>');
  process.exit(1);
}
if (!existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}
const file = basename(filePath);
if (!/^[a-z0-9-]+\.mp3$/.test(file)) {
  console.error(`File name must be lowercase-with-dashes and end in .mp3 (got "${file}").`);
  process.exit(1);
}
const key = `tracks/${file}`;

console.log(`Uploading ${filePath} -> R2 (superhuman-audio): ${key}`);
const r = spawnSync(
  'npx',
  ['wrangler', 'r2', 'object', 'put', `superhuman-audio/${key}`, '--file', filePath, '--content-type', 'audio/mpeg', '--remote'],
  { stdio: 'inherit' },
);
process.exit(r.status ?? 1);
```

- [ ] **Step 2: Add the npm script**

Edit `package.json`. Add an `audio:upload` entry to `scripts`:

```json
{
  "scripts": {
    "dev": "astro dev",
    "start": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check",
    "test": "vitest run",
    "test:watch": "vitest",
    "audio:upload": "node scripts/upload-audio.mjs"
  }
}
```

- [ ] **Step 3: Sanity-run the script with no args, expect the usage message**

Run: `npm run audio:upload`
Expected: exits non-zero with "Usage: npm run audio:upload <path/to/track.mp3>".

- [ ] **Step 4: Commit**

```bash
git add scripts/upload-audio.mjs package.json
git commit -m "upload-audio: helper script for putting MP3 files into the AUDIO R2 bucket"
```

---

### Task 21: Full test + type + build verification

**Files:**
- (no edits)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Run type checking**

Run: `npm run check`
Expected: zero errors.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: build completes without errors. `dist/` contains rendered output.

- [ ] **Step 4: If any step fails, fix and re-run**

Do not proceed past this task until all three are clean.

---

### Task 22: Manual smoke test in dev

**Files:**
- (no edits)

This task assumes one seed YAML exists for each service. If the operator has not yet provided audio files and YAML, create temporary placeholder YAML files (still committable as content fixtures) so the smoke test can run. Use a fixture MP3 keyed `tracks/sample.mp3` uploaded to R2 once.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts on `http://localhost:4321`.

- [ ] **Step 2: Visit `/audio/` and confirm**

In a browser: open `http://localhost:4321/audio/`. Confirm:
- Hero renders with "Available for audio engagements" eyebrow.
- Four service sections render (Mixing, Mastering, Production, Recording).
- Empty sections show "More examples coming."
- Booking form renders with all fields. Turnstile widget loads.

- [ ] **Step 3: Visit `/audio/about` and confirm**

Open `http://localhost:4321/audio/about`. Confirm the about copy renders and the cross-site link points at `https://thesuperhuman.us`.

- [ ] **Step 4: Submit the booking form**

Fill in valid data. Submit. Confirm the success message renders. Resend won't deliver in dev unless secrets are set; a 500 response is acceptable in local dev as long as validation and the request reach the endpoint.

- [ ] **Step 5: Confirm the existing software site still works**

Open `http://localhost:4321/` and `http://localhost:4321/about`. Confirm both pages render correctly (the prerender opt-out from Task 6 should be invisible to the browser).

- [ ] **Step 6: Stop the dev server**

Ctrl+C.

---

### Task 23: Operator runbook (manual, documented)

Some steps require operator access to Cloudflare and DNS. Document them here so the operator can run them at deploy time.

- [ ] **Step 1: Create the R2 bucket**

Run (operator, with Cloudflare-authenticated CLI):

```bash
npx wrangler r2 bucket create superhuman-audio
```

- [ ] **Step 2: Add the DNS record**

In Cloudflare DNS for `thesuperhuman.us`, add:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | audio | thesuperhuman.us | Proxied (orange cloud) |

(Or an A record pointing at the same Worker; CNAME-with-flattening at the apex still works for the subdomain.)

- [ ] **Step 3: Deploy**

```bash
npm run build
npx wrangler deploy
```

Wrangler picks up the new route entries from `wrangler.jsonc` and serves the audio host from the same Worker.

- [ ] **Step 4: Verify production**

- Visit `https://audio.thesuperhuman.us/` and confirm the audio landing page renders.
- Visit `https://audio.thesuperhuman.us/about` and confirm the about page renders.
- Confirm `https://thesuperhuman.us/` (software site) still renders normally.
- Send a test booking inquiry and confirm the email arrives at `kazon.wilson@thesuperhuman.us`.

- [ ] **Step 5: Confirm at least one track per service is published before announcing**

Per the spec's launch prerequisites, do not link to or announce the audio site until each of the four service sections has at least one real track example.

---

## Self-review checklist

The plan was self-reviewed against the spec on 2026-05-17:

- **Spec coverage:** every spec section maps to one or more tasks. Routing → Tasks 1, 4, 5, 6. Content model → Task 3. Storage + player → Tasks 1, 8, 14, 16. Booking flow → Tasks 9, 10, 11, 17. Visual system → Tasks 12-18. About content → Tasks 18, 19. Launch prerequisites → Task 22, Task 23 step 5. Out-of-scope items → not addressed (correct).
- **Placeholders:** no TBD/TODO; every step has actual code.
- **Type consistency:** `AudioTrack`, `AudioService`, `AudioRole` defined in Task 7 and referenced consistently in Tasks 14, 15, 18.
- **Known caveat:** Task 18 contains a script-tag correction inline. The implementer should use the `import '~/scripts/audio-player-coordinator';` form, not the standalone `src=` form.
