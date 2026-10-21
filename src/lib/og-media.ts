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
    alt: 'Kazon Wilson’s name in large serif type, the tagline “Software, sound, and things worth exploring.” and the line “I build software, design websites, and mix and master music.” beside an illustrated desk with a monitor of code, a plant, a game controller, headphones and a sketched notebook.',
  },
  about: {
    routes: ['/about'],
    alt: 'About: “A little more about me.” above “I’m Kazon. Software engineer, audio engineer, and a person who likes figuring things out.” and the chapters Audio, Software, Play and What’s next, beside an illustrated pale terrain with a terracotta path winding past small trees.',
  },
  work: {
    routes: ['/work'],
    alt: 'Work: “Software engineer. I build useful software.” and “7+ years in production engineering”, above a Lyft panel reading 5,000 → 100,000+ rows per batch, drawn as twenty terracotta cells and labelled owner-reported batch capacity.',
  },
  services: {
    routes: ['/services'],
    alt: 'Work with me: “Three ways to work with me.” Three framed pictures: the Old News record cover for mixing and mastering, a screenshot of this site for website design and the Tally budgeting demo for software engineering, above “Every project is fixed price and agreed in writing before work begins.”',
  },
  'software-start': {
    routes: ['/software/start'],
    alt: 'Project brief: “What are you working on?” Three choices: Website design, a site people can read on a phone and act on; Web app, an app people open in a browser, on a phone or a computer; and Workflow automation, a tool that takes manual steps out of a task your team repeats.',
  },
  'personal-website': {
    routes: ['/building/personal-website', '/building/personal-website/*'],
    alt: 'Personal website: “Same palette. A different introduction.” Two homepage captures meet at a divider: the September 10 redesign with a large “Kazon Wilson” and a potted plant, and the original homepage’s portrait of Kazon.',
  },
  'personal-website-story': {
    routes: ['/building/personal-website/story'],
    alt: 'Personal website story: “Four ways the same palette could feel.” beside a grid of four generated homepage design studies cropped to their artwork: a quiet desk, linked sketches, a sound and pixel-game gallery and a winding landscape. The first is marked “A · Quiet studio, Chosen for Home.”',
  },
  writing: {
    routes: ['/writing', '/writing/*'],
    alt: 'Writing: “Notes on engineering, tools, and the choices behind the work.” over a hand-drawn underline, beside an illustration of a terracotta path winding through four checkpoints to an arrow.',
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
