import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const footer = read('src/components/Footer.astro');
const global = read('src/styles/global.css');

it('keeps the footer landmark, class names and nav label', () => {
  expect(footer).toContain('<footer class="compact-footer site-shell">');
  expect(footer).toContain('<nav aria-label="Elsewhere">');
  expect(footer).toContain('.footer-name { font-size: 1.5rem;');
});

it('defaults to the invitation with the approved copy and target', () => {
  expect(footer).toContain("variant = 'invitation'");
  expect(footer).toContain("heading = 'Let’s work together.'");
  expect(footer).toContain("line = 'Every project is fixed price and agreed in writing before work begins.'");
  expect(footer).toContain("buttonLabel = 'Work with me'");
  expect(footer).toContain("buttonPath = '/services'");
  expect(footer).not.toMatch(/compact\?: boolean/);
});

it('shows the heading, line and large pill only in the invitation', () => {
  expect(footer).toMatch(/variant === 'invitation' && [\s\S]*<h2 class="closing-heading">\{heading\}<\/h2>[\s\S]*<p class="closing-line">\{line\}<\/p>[\s\S]*<a class="site-button site-button-large" href=\{mainHref\(buttonPath\)\}>\{buttonLabel\} <span aria-hidden="true">→<\/span><\/a>/);
});

it('keeps Work with me in the links only when there is no button', () => {
  expect(footer).toMatch(/variant === 'quiet' && <a href=\{hireHref\}>Work with me<\/a>/);
});

it('draws the panel from tokens with no border, shadow or motion', () => {
  expect(footer).toMatch(/\.closing-panel \{[^}]*background: var\(--panel\);[^}]*border-radius: var\(--radius-panel\);/);
  expect(footer).toMatch(/\.closing-panel \{[^}]*padding: 4\.5rem 2rem 2\.25rem;/);
  expect(footer).toMatch(/\.closing-panel--quiet \{[^}]*padding-top: 3rem;/);
  expect(footer).toMatch(/@media \(max-width: 600px\) \{[^@]*\.closing-panel \{[^}]*border-radius: 28px;[^}]*padding: 3rem 1\.25rem 1\.75rem;/);
  expect(footer).not.toMatch(/border-top|box-shadow|data-reveal|animation|#[0-9a-fA-F]{3,6}\b/);
});

it('sets the space above and below the panel', () => {
  expect(footer).toMatch(/\.compact-footer \{[^}]*margin-top: var\(--site-section-space\);[^}]*padding-bottom: var\(--space-8\);/);
});

it('sizes the heading and line as specified', () => {
  expect(footer).toMatch(/\.closing-heading \{[^}]*font-size: clamp\(2rem, 3\.6vw, 2\.9rem\);[^}]*line-height: 1\.08;[^}]*letter-spacing: -\.03em;[^}]*text-wrap: balance;/);
  expect(footer).toMatch(/\.closing-line \{[^}]*font-size: 1\.125rem;[^}]*color: var\(--muted\);[^}]*max-width: 28rem;/);
});

it('keeps the global pill button used by the closing panel', () => {
  expect(global).toMatch(/\.site-button \{[^}]*border-radius: var\(--radius-button\);/);
});
