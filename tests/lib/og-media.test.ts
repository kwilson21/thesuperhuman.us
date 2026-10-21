import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import rendered from '../../src/data/og-media.json';
import { DEFAULT_OG_SCENE, OG_SCENES, ogMedia, ogSceneFor, serveOgVideo, type OgScene } from '~/lib/og-media';

const scenes = Object.keys(OG_SCENES) as OgScene[];
const sceneFiles = readdirSync('scripts/og-video/scenes').filter(name => name.endsWith('.html')).map(name => name.slice(0, -5));
const { video } = ogMedia(DEFAULT_OG_SCENE);
const name = video.slice('/og/'.length, -'.mp4'.length);
const bytes = new Uint8Array(Array.from({ length: 200 }, (_, index) => index));
const assets = { fetch: async (input: RequestInfo | URL) => String(input).endsWith(`/og/raw/${name}.mp4`) ? new Response(bytes) : new Response('Not found', { status: 404 }) } as unknown as Fetcher;
const request = (headers: Record<string, string> = {}, method = 'GET') => new Request(`https://thesuperhuman.us${video}`, { method, headers });

describe('link-preview video route', () => {
  it('serves the whole file with range support advertised', async () => {
    const response = await serveOgVideo(request(), name, assets);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe('200');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it.each([
    ['bytes=0-99', 0, 99],
    ['bytes=150-', 150, 199],
    ['bytes=-20', 180, 199],
    ['bytes=190-999', 190, 199],
  ])('answers %s with 206 and exactly those bytes', async (range, start, end) => {
    const response = await serveOgVideo(request({ range }), name, assets);
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/200`);
    expect(response.headers.get('content-length')).toBe(String(end - start + 1));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(start, end + 1));
  });

  it('refuses unsatisfiable ranges with the file size', async () => {
    const response = await serveOgVideo(request({ range: 'bytes=200-' }), name, assets);
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */200');
  });

  it('answers HEAD with headers and no body', async () => {
    const response = await serveOgVideo(request({}, 'HEAD'), name, assets);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('200');
    expect(await response.text()).toBe('');
  });

  it.each([undefined, 'missing-0000000000', '../raw/x'])('serves only rendered videos, not %s', async value => {
    const response = await serveOgVideo(request(), value, assets);
    expect(response.status).toBe(404);
  });
});

describe('scene routing', () => {
  it('prefers an exact route, then the longest family, else nothing', () => {
    const exact = scenes.flatMap(scene => OG_SCENES[scene].routes.filter(route => !route.endsWith('/*')).map(route => [route, scene] as const));
    for (const [route, scene] of exact) expect(ogSceneFor(route)).toEqual({ scene, exact: true });
    for (const scene of scenes) {
      for (const route of OG_SCENES[scene].routes.filter(route => route.endsWith('/*'))) {
        const page = `${route.slice(0, -1)}an-unlisted-page`;
        const match = ogSceneFor(page);
        expect(match?.exact).toBe(false);
        expect(OG_SCENES[match!.scene].routes.some(other => other.endsWith('/*') && page.startsWith(other.slice(0, -1)))).toBe(true);
      }
    }
    expect(ogSceneFor('/no-such-section/page')).toBeNull();
  });

  it('gives each route to one scene', () => {
    const routes = scenes.flatMap(scene => OG_SCENES[scene].routes);
    expect(new Set(routes).size).toBe(routes.length);
  });
});

describe('rendered scenes', () => {
  it('has exactly one rendered entry and one scene file per scene', () => {
    expect(Object.keys(rendered).sort()).toEqual([...scenes].sort());
    expect(sceneFiles.sort()).toEqual([...scenes].sort());
  });

  it.each(scenes)('%s has a 1200×630 poster, a streamable MP4 and plain alt text', scene => {
    const media = ogMedia(scene);
    expect(media.alt.length).toBeGreaterThan(20);
    expect(media.alt).not.toMatch(/—/);
    const poster = readFileSync(`public${media.image}`);
    expect(poster.subarray(1, 4).toString()).toBe('PNG');
    expect([poster.readUInt32BE(16), poster.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(poster.length).toBeLessThan(600 * 1024);
    const file = `public/og/raw/${media.video.slice('/og/'.length)}`;
    expect(existsSync(`public${media.video}`)).toBe(false);
    const mp4 = readFileSync(file);
    expect(mp4.length).toBeLessThan(2.5 * 1024 * 1024);
    const boxes: string[] = [];
    for (let offset = 0; offset < mp4.length; offset += mp4.readUInt32BE(offset)) boxes.push(mp4.subarray(offset + 4, offset + 8).toString());
    expect(boxes.indexOf('moov')).toBeGreaterThan(-1);
    expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));
  });

  it('keeps no stale files beside the current ones', () => {
    const current = new Set(scenes.flatMap(scene => [ogMedia(scene).image.slice('/og/'.length), ogMedia(scene).video.slice('/og/'.length)]));
    const files = [...readdirSync('public/og').filter(file => file !== 'raw'), ...readdirSync('public/og/raw')];
    expect(files.filter(file => !current.has(file))).toEqual([]);
  });
});
