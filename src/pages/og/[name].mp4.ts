import type { APIRoute } from 'astro';
import { serveOgVideo } from '~/lib/og-media';
export const prerender = false;
// In astro dev the platform proxy's ASSETS reads ./dist, which lags behind a fresh render; the dev
// server itself serves public/og/raw/.
const serve: APIRoute = ({ params, request, locals }) => serveOgVideo(request, params.name, import.meta.env.DEV ? undefined : locals.runtime?.env.ASSETS);
export const GET = serve;
export const HEAD = serve;
