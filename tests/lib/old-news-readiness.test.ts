import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')) as { visibility?: string };

it('keeps every Old News publishing surface draft until launch verification passes', () => {
  const paths = [
    'src/content/releases/old-news-single.json',
    'src/content/recordings/old-news-recording.json',
    'src/content/audio-examples/old-news-mastering.json',
  ];
  expect(paths.map(path => read(path).visibility)).toEqual(['draft', 'draft', 'draft']);
});
