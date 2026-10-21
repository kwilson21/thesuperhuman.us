import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { transform } from '@astrojs/compiler';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_OG_SCENE, OG_SCENES, ogMedia, type OgScene } from '~/lib/og-media';

let layout: any, directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve('.og-tags-render-'));
  await build({ entryPoints: { layout: 'src/layouts/BaseLayout.astro' }, outdir: directory, outExtension: { '.js': '.mjs' }, bundle: true, format: 'esm', platform: 'node', packages: 'external',
    plugins: [{ name: 'astro-test-render', setup(builder) {
      builder.onResolve({ filter: /\.css(?:\?|$)|\?astro/ }, () => ({ path: 'empty-style', namespace: 'empty' }));
      builder.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '', loader: 'js' }));
      builder.onResolve({ filter: /^~\// }, args => ({ path: resolve('src', args.path.slice(2)) + (args.path.endsWith('.astro') ? '' : '.ts') }));
      builder.onLoad({ filter: /\.astro$/ }, async args => ({ contents: (await transform(await readFile(args.path, 'utf8'), { filename: args.path, internalURL: 'astro/compiler-runtime', astroGlobalArgs: '"https://thesuperhuman.us"', resolvePath: specifier => specifier })).code, loader: 'ts', resolveDir: dirname(args.path) }));
    } }],
  });
  layout = (await import(/* @vite-ignore */ pathToFileURL(resolve(directory, 'layout.mjs')).href)).default;
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function head(path: string, props: Record<string, unknown> = {}) {
  const container = await AstroContainer.create();
  const html = await container.renderToString(layout, { props: { title: 'Title', description: 'Description', ...props }, request: new Request(`https://thesuperhuman.us${path}`) });
  return [...html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)"/g)].map(([, key, value]) => [key, value.replaceAll('&amp;', '&')] as const);
}
const value = (tags: (readonly [string, string])[], key: string) => tags.find(([name]) => name === key)?.[1];
const exactRoute = (Object.keys(OG_SCENES) as OgScene[]).flatMap(scene => OG_SCENES[scene].routes.filter(route => !route.endsWith('/*')).map(route => ({ scene, route })))[0];

describe('link-preview tags', () => {
  it('describe the page scene as a poster image plus a video Messages can play', async () => {
    const tags = await head(exactRoute.route);
    const media = ogMedia(exactRoute.scene);
    const video = `https://thesuperhuman.us${media.video}`;
    expect(value(tags, 'og:image')).toBe(`https://thesuperhuman.us${media.image}`);
    expect(value(tags, 'og:image:width')).toBe('1200');
    expect(value(tags, 'og:image:height')).toBe('630');
    expect(value(tags, 'og:image:alt')).toBe(media.alt);
    expect(value(tags, 'og:video')).toBe(video);
    expect(value(tags, 'og:video:secure_url')).toBe(video);
    expect(video).toMatch(/^https:\/\/thesuperhuman\.us\/og\/[a-z0-9-]+\.mp4$/);
    expect(value(tags, 'og:video:type')).toBe('video/mp4');
    expect(value(tags, 'og:video:width')).toBe('1200');
    expect(value(tags, 'og:video:height')).toBe('630');
    expect(value(tags, 'twitter:card')).toBe('summary_large_image');
    // Apple's reader starts a new video at a URL tag that follows a type or size tag.
    const order = tags.map(([name]) => name).filter(name => name.startsWith('og:video'));
    expect(order).toEqual(['og:video', 'og:video:secure_url', 'og:video:type', 'og:video:width', 'og:video:height']);
  });

  it('use the default scene for a page with no scene and no image', async () => {
    const tags = await head('/no-such-section/page');
    expect(value(tags, 'og:video')).toBe(`https://thesuperhuman.us${ogMedia(DEFAULT_OG_SCENE).video}`);
  });

  it('keep a page’s own image, without a video, when no scene names that page', async () => {
    const tags = await head('/no-such-section/page', { ogImage: '/artwork.webp' });
    expect(value(tags, 'og:image')).toBe('https://thesuperhuman.us/artwork.webp');
    expect(tags.some(([name]) => name.startsWith('og:video') || name.startsWith('og:image:'))).toBe(false);
  });

  it('let a page choose its scene when its URL cannot', async () => {
    const scene = (Object.keys(OG_SCENES) as OgScene[]).at(-1)!;
    const tags = await head('/this-page-does-not-exist', { ogScene: scene });
    expect(value(tags, 'og:video')).toBe(`https://thesuperhuman.us${ogMedia(scene).video}`);
  });
});
