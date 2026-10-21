import type { APIRoute } from 'astro';
import { serveOgVideo } from '~/lib/og-media';
export const prerender = false;
const serve: APIRoute = ({ params, request, locals }) => serveOgVideo(request, params.name, locals.runtime?.env.ASSETS);
export const GET = serve;
export const HEAD = serve;
