export type TrafficSummary = { visits: number; requests: number };
export type TrafficRange = { start: Date; end: Date };
export type TrafficResult = { status: 'available'; summary: TrafficSummary } | { status: 'unavailable'; dashboardUrl: string };

const dashboardUrl = 'https://dash.cloudflare.com/';
const query = `query OwnerTraffic($zoneTag: string!, $filter: ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!) {
  viewer { zones(filter: { zoneTag: $zoneTag }) {
    totals: httpRequestsAdaptiveGroups(limit: 1, filter: $filter) { count sum { visits } }
  } }
}`;

export async function loadTrafficSummary(env: Env, range: TrafficRange): Promise<TrafficResult> {
  if (!env.CLOUDFLARE_ANALYTICS_TOKEN || !env.CLOUDFLARE_ZONE_ID) return { status: 'unavailable', dashboardUrl };
  const start = range.start.toISOString(), end = range.end.toISOString();
  if (range.start >= range.end || range.end.getTime() - range.start.getTime() > 31 * 86_400_000) return { status: 'unavailable', dashboardUrl };
  try {
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST', signal: AbortSignal.timeout(5_000),
      headers: { authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { zoneTag: env.CLOUDFLARE_ZONE_ID, filter: {
        datetime_geq: start, datetime_lt: end, requestSource: 'eyeball', clientRequestHTTPHost: 'thesuperhuman.us',
      } } }),
    });
    if (!response.ok) return { status: 'unavailable', dashboardUrl };
    const body = await response.json() as { data?: { viewer?: { zones?: { totals?: { count?: unknown; sum?: { visits?: unknown } }[] }[] } }; errors?: unknown[] };
    const total = body.data?.viewer?.zones?.[0]?.totals?.[0];
    if (body.errors?.length || typeof total?.count !== 'number' || typeof total.sum?.visits !== 'number') return { status: 'unavailable', dashboardUrl };
    return { status: 'available', summary: { visits: total.sum.visits, requests: total.count } };
  } catch {
    return { status: 'unavailable', dashboardUrl };
  }
}
