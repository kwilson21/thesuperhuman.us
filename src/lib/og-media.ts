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
    alt: 'Project brief: “What are you working on?” Three choices, Website design, Web app and Workflow automation, beside “Not sure which? Pick the closest. I’ll suggest the right fit when I reply.” and a note that nothing is booked or paid yet.',
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
  audio: {
    routes: ['/audio', '/audio/*'],
    alt: 'Audio: “Mixing and mastering.” and “From $150 per song for two-track vocal mixing.” with a Start your song button, beside black and bronze headphones above line icons for mixing, mastering, production and recording.',
  },
  'audio-portfolio': {
    routes: ['/audio/portfolio'],
    alt: 'Audio portfolio: “Hear the difference.” and “Switch versions. Keep your place.” beside the Old News cover, with an A and B switch set to the master above the mix and master waveforms of the song, played to the same point.',
  },
  'audio-releases': {
    routes: ['/audio/releases'],
    alt: 'Releases: “Music by Kazon.” over a sepia drawing of a city skyline, bridge and river at sunset, with the Old News single cover beside its title, “Prod. Lexi Banks” and a play button.',
  },
  'audio-services': {
    routes: ['/audio/services'],
    alt: 'Audio services: “Your song. My full attention.” and “We agree on the work and price before you book.” beside a price sheet: two-track vocal mixing from $150, mastering from $75, and a two-track vocal mix plus master from $200.',
  },
  'audio-start': {
    routes: ['/audio/start'],
    alt: 'Start your song, step 1 of 3: Service, Song & direction, Review. “What does your song need?” over “I’ll review your files before you book.” with two-track vocal mixing from $150 selected, a Continue button and “No payment now.”',
  },
  'music-old-news': {
    routes: ['/music/old-news'],
    alt: 'Old News: a newspaper masthead with Kazon, the title OLD NEWS and “Prod. Lexi Banks · single”, above the release art of a folded newspaper headed Kazon by a river and city skyline at sunset, with a play button to watch the lyric video.',
  },
  privacy: {
    routes: ['/privacy'],
    alt: 'Privacy: “The website’s page code does not include advertising trackers.” above how long records last: form rate-limit records, five minutes; pending resume requests, seven days.',
  },
  'not-found': {
    routes: [],
    alt: '404: “This page isn’t here.” and “The link may have changed.” with a Back to home button, beside a painted coast with grassy dunes, a curved beach and calm water.',
  },
  building: {
    routes: ['/building', '/building/*'],
    alt: 'Building: “Things I’m making.” beside the projects Tally, Kaillera-next and the personal website with their statuses, and an illustration of Tally’s flow from transactions to categories to a monthly budget.',
  },
  'project-tally': {
    routes: ['/building/tally'],
    alt: 'Tally: “Review your transactions, set monthly budgets and see how much remains to spend.” beside Tally’s home screen on demo data, with its demo data banner along the top and the Safe to spend figure, $283, ringed and labelled.',
  },
  'project-kaillera-next': {
    routes: ['/building/kaillera-next'],
    alt: 'Kaillera Next: “Open a link and play supported N64 games with friends, nothing to install.” In development, playable demo build. Beside it, the landing page and a rollback diagram of frames under a playhead, an arc back to a wrong guess, and “Guess a late input, keep playing, and rewind if the guess was wrong.”',
  },
  'project-threadline': {
    routes: ['/building/threadline'],
    alt: 'Threadline: “Pick up where you left off.” and “Pick up interrupted development work with its context intact.” Internal prototype. Beside it, an illustration of three paper notes, Work, Switch and Return, pinned to a sunlit wall and joined by one terracotta thread from a spool.',
  },
  'the-engineers-daily': {
    routes: ['/building/the-engineers-daily'],
    alt: 'The Engineer’s Daily: “A daily practice of faith and craft.” Arrive, Practice, Reflect. Local prototype. Beside it, a screenshot of the Day 12 lesson “An honest default.” with its illustrated harbor-view desk.',
  },
  'writing-ai-gives-you-speed': {
    routes: ['/writing/ai-gives-you-speed'],
    alt: '“AI Gives You Speed. Engineering Gives It Direction.” above an illustration of course correction: without checkpoints a dashed path drifts away from the intended outcome; with checkpoints a terracotta path passes three checkpoints and reaches it.',
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
