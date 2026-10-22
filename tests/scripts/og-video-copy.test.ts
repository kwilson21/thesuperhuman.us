import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'parse5';
import { describe, expect, it } from 'vitest';
import { audioOffers } from '~/lib/audio-intake';

// Link-preview scenes copy the site's own words, prices and statuses into public videos. Any line of
// four or more words must still appear verbatim in src/, so a change to the page fails here and names
// the scene to re-render (node scripts/og-video/render.mjs <scene>). Lines the page composes from data
// are rebuilt from that data below; the rest are short composite labels or text read from a reviewed image.
const SCENES = 'scripts/og-video/scenes';
// The link-preview alt text quotes the scenes, so it cannot vouch for them.
const corpus = readdirSync('src', { recursive: true })
  .filter((file): file is string => typeof file === 'string' && /\.(astro|ts|md|mdx|json)$/.test(file) && !/og-media\.(ts|json)$/.test(file))
  .map(file => readFileSync(join('src', file), 'utf8'))
  .join('\n')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');
const composed = new Set([
  // src/components/audio/AudioHero.astro builds its price lede from audioOffers.
  `From $${audioOffers['vocal-mix'].price} per song for two-track vocal mixing.`,
]);
const labels: Record<string, Record<string, string>> = {
  'audio-portfolio': { '· Prod. Lexi Banks': 'credit from src/content/recordings/old-news-recording.json after a separator' },
  'audio-start': { 'Audio / Start your song': 'composite kicker: section and page' },
  'personal-website': { 'Building / Personal website': 'breadcrumb, src/layouts/ProjectLayout.astro' },
  'project-kaillera-next': { 'Guess a late input, keep playing,': 'src/data/project-stories/kaillera-next.ts:110, first letter capitalized to open the caption' },
  'personal-website-story': {
    'Building / Personal website': 'breadcrumb, src/layouts/ProjectLayout.astro',
    'Sep 9, 2026 · Alternatives': 'the story entry’s date and label',
  },
  'project-tally': {
    'The headline: how much is left to spend this month.': 'legend of the reviewed annotated capture src/assets/projects/tally/home-annotated.webp',
    'Written by code from the numbers, not by AI.': 'legend of the reviewed annotated capture src/assets/projects/tally/home-annotated.webp',
    'How many transactions are uncategorized; opens that filtered list.': 'legend of the reviewed annotated capture src/assets/projects/tally/home-annotated.webp',
    'Spent of budget for each category, drawn as SVG.': 'legend of the reviewed annotated capture src/assets/projects/tally/home-annotated.webp',
  },
  'writing-ai-gives-you-speed': { 'Writing / AI-assisted engineering': 'composite kicker: section and essay topic' },
};

type Node = { nodeName: string; value?: string; childNodes?: Node[]; content?: Node };
function lines(node: Node, out: string[] = []): string[] {
  if (node.nodeName === 'script' || node.nodeName === 'style') return out;
  if (node.nodeName === '#text') {
    const text = node.value!.replace(/\s+/g, ' ').trim();
    if (text.split(' ').length >= 4) out.push(text);
  }
  for (const child of node.childNodes ?? []) lines(child, out);
  if (node.content) lines(node.content, out);
  return out;
}

function allText(node: Node, out: string[] = []): string[] {
  if (node.nodeName === 'script' || node.nodeName === 'style') return out;
  if (node.nodeName === '#text') out.push(node.value!);
  for (const child of node.childNodes ?? []) allText(child, out);
  if (node.content) allText(node.content, out);
  return out;
}

const scenes = readdirSync(SCENES).filter(file => file.endsWith('.html')).map(file => file.slice(0, -5));

describe('link-preview scene copy', () => {
  it.each(scenes)('%s shows only the site’s current words', scene => {
    const text = [...new Set(lines(parse(readFileSync(join(SCENES, `${scene}.html`), 'utf8')) as Node))];
    const stale = text.filter(line => !corpus.includes(line) && !composed.has(line) && !labels[scene]?.[line]);
    expect(stale, `re-render ${scene} after updating it`).toEqual([]);
  });

  it.each(scenes)('%s shows only current audio starting prices', scene => {
    const prices = new Set(Object.values(audioOffers).map(offer => offer.price).filter(price => price != null).map(String));
    const shown = allText(parse(readFileSync(join(SCENES, `${scene}.html`), 'utf8')) as Node).join(' ').match(/\$\d[\d,]*/g) ?? [];
    expect(shown.filter(amount => !prices.has(amount.slice(1).replace(/,/g, ''))), `re-render ${scene} after updating it`).toEqual([]);
  });

  it('lists only labels a scene still shows', () => {
    for (const [scene, entries] of Object.entries(labels)) {
      const text = lines(parse(readFileSync(join(SCENES, `${scene}.html`), 'utf8')) as Node);
      for (const label of Object.keys(entries)) expect(text, scene).toContain(label);
    }
  });
});
