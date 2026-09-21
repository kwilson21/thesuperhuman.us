import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const styles = readFileSync(new URL('../../src/styles/owner.css', import.meta.url), 'utf8');

it('opens owner metric definitions into the readable side of a mobile viewport', () => {
  expect(styles).toContain('.metric-definition>div{left:0;right:auto}');
  expect(styles).toContain('.supporting-evidence .metric-definition>div{left:auto;right:0}');
});
