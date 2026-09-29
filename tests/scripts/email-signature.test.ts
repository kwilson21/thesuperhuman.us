import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SITE_ORIGIN = 'https://thesuperhuman.us/';
const html = readFileSync(`${ROOT}public/email/signature.html`, 'utf8');

/** Returns every start tag with the given name as its raw attribute text. */
function tags(name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map(match => match[1]);
}

/** Reads one attribute's value out of a raw attribute string, or null when absent. */
function attribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? (match[1] ?? match[2]) : null;
}

describe('email signature page', () => {
  it('has no style or script elements, so a copy carries only inline markup', () => {
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/<script\b/i);
  });

  it('stays out of search indexes', () => {
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it('uses absolute https URLs for every link and image, since a mail client has no base URL', () => {
    const urls = [...html.matchAll(/\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map(match => match[1] ?? match[2]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(/^https:\/\//);
  });

  it('gives every image alt text and explicit dimensions', () => {
    const images = tags('img');
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(attribute(image, 'alt')?.trim()).toBeTruthy();
      expect(attribute(image, 'width')).toMatch(/^\d+$/);
      expect(attribute(image, 'height')).toMatch(/^\d+$/);
    }
  });

  it('serves every hosted image from a file in public/ at 3x its displayed size', async () => {
    const hosted = tags('img').filter(image => attribute(image, 'src')?.startsWith(SITE_ORIGIN));
    expect(hosted.length).toBeGreaterThan(0);
    for (const image of hosted) {
      const path = `public/${attribute(image, 'src')!.slice(SITE_ORIGIN.length)}`;
      expect(existsSync(`${ROOT}${path}`), `${path} exists`).toBe(true);
      const { width, height } = await sharp(`${ROOT}${path}`).metadata();
      expect({ width, height }).toEqual({
        width: Number(attribute(image, 'width')) * 3,
        height: Number(attribute(image, 'height')) * 3,
      });
    }
  });
});
