import rendered from '../data/og-media.json';
import { mediaRange } from '~/lib/music-media';

/**
 * Link-preview scenes: each is a looping silent video whose first frame is also the page's
 * og:image. scripts/og-video/render.mjs renders scripts/og-video/scenes/<scene>.html into
 * public/og/ and records the hashed file names in src/data/og-media.json.
 *
 * `routes` lists canonical paths. A path ending in `/*` covers every page below it, but a page
 * that passes its own ogImage (a music release's artwork) keeps that image instead.
 * `alt` describes the poster frame.
 */
export const OG_SCENES = {
  home: {
    routes: ['/'],
    alt: 'Kazon Wilson’s card: his name, “I build software, design websites, and mix and master music.” and a desk with a monitor of code, a plant, headphones, a game controller and a notebook.',
  },
} satisfies Record<string, { routes: string[]; alt: string }>;

export type OgScene = keyof typeof OG_SCENES;

/** Pages with no scene of their own and no image of their own use this one. */
export const DEFAULT_OG_SCENE: OgScene = 'home';

export interface OgMedia {
  image: string;
  alt: string;
  width: number;
  height: number;
  video: string;
}

interface Rendered {
  image: string;
  video: string;
  width: number;
  height: number;
}

const renderedScenes: Record<string, Rendered | undefined> = rendered;

/** The scene for a canonical path: an exact route, otherwise the longest matching `/*` family. */
export function ogSceneFor(pathname: string): { scene: OgScene; exact: boolean } | null {
  let family: { scene: OgScene; length: number } | null = null;
  for (const [scene, { routes }] of Object.entries(OG_SCENES) as [OgScene, { routes: string[] }][]) {
    for (const route of routes) {
      if (route === pathname) return { scene, exact: true };
      if (route.endsWith('/*')) {
        const base = route.slice(0, -1);
        if (pathname.startsWith(base) && (!family || base.length > family.length)) family = { scene, length: base.length };
      }
    }
  }
  return family && { scene: family.scene, exact: false };
}

export function ogMedia(scene: OgScene): OgMedia {
  const files = renderedScenes[scene];
  if (!files) throw new Error(`Link-preview scene ${scene} has not been rendered. Run node scripts/og-video/render.mjs ${scene}.`);
  return { image: files.image, video: files.video, width: files.width, height: files.height, alt: OG_SCENES[scene].alt };
}

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Serves /og/<name>.mp4 with byte ranges. Static assets answer every request with the whole file
 * and no Accept-Ranges, and Safari's media stack expects 206 responses, so the bytes live at
 * /og/raw/<name>.mp4 and this route slices them.
 */
export async function serveOgVideo(request: Request, name: string | undefined, assets: Pick<Fetcher, 'fetch'> | undefined): Promise<Response> {
  const path = `/og/${name}.mp4`;
  if (!name || !Object.values(renderedScenes).some(files => files?.video === path)) return new Response('Not found', { status: 404 });
  const source = await (assets ?? globalThis).fetch(new URL(`/og/raw/${name}.mp4`, request.url));
  if (!source.ok) return new Response('Not found', { status: 404 });
  const bytes = await source.arrayBuffer();
  const size = bytes.byteLength;
  const range = request.method === 'HEAD' ? null : mediaRange(request.headers.get('range'), size);
  if (range === 'invalid') return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  const headers = new Headers({
    'content-type': 'video/mp4',
    'accept-ranges': 'bytes',
    'content-length': String(range?.length ?? size),
    'cache-control': IMMUTABLE,
  });
  if (range) headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
  if (request.method === 'HEAD') return new Response(null, { headers });
  return new Response(range ? bytes.slice(range.offset, range.offset + range.length) : bytes, { status: range ? 206 : 200, headers });
}
