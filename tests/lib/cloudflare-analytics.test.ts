import { afterEach, expect, it, vi } from 'vitest';
import { loadTrafficSummary } from '~/lib/cloudflare-analytics';

afterEach(() => vi.unstubAllGlobals());
const range = { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-09-19T00:00:00Z') };

it('returns a safe fallback without analytics configuration', async () => {
  const result = await loadTrafficSummary({} as Env, range);
  expect(result).toEqual({ status: 'unavailable', dashboardUrl: 'https://dash.cloudflare.com/' });
});

it('requests only eyeball traffic for the production hostname', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { viewer: { zones: [{ totals: [{ count: 48, sum: { visits: 21 } }] }] } } }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const result = await loadTrafficSummary({ CLOUDFLARE_ANALYTICS_TOKEN: 'secret', CLOUDFLARE_ZONE_ID: 'zone' } as Env, range);
  expect(result).toEqual({ status: 'available', summary: { visits: 21, requests: 48 } });
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.variables.filter).toMatchObject({ requestSource: 'eyeball', clientRequestHTTPHost: 'thesuperhuman.us' });
});

it('falls back on failed or malformed analytics responses', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"data":{}}', { status: 200 })));
  await expect(loadTrafficSummary({ CLOUDFLARE_ANALYTICS_TOKEN: 'secret', CLOUDFLARE_ZONE_ID: 'zone' } as Env, range))
    .resolves.toMatchObject({ status: 'unavailable' });
});
