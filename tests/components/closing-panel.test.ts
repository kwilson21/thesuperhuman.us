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

it('shows the heading, line and large pill only in the invitation, before the nav', () => {
  const start = footer.indexOf("{variant === 'invitation' && <>");
  const end = footer.indexOf('</>}', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const gated = footer.slice(start, end + '</>}'.length);
  expect(gated).toContain('<h2 class="closing-heading">{heading}</h2>');
  expect(gated).toContain('<p class="closing-line">{line}</p>');
  expect(gated).toContain('<a class="site-button site-button-large" href={mainHref(buttonPath)}>{buttonLabel} <span aria-hidden="true">→</span></a>');
  expect(gated).not.toContain('<nav');
  expect(start).toBeLessThan(footer.indexOf('<nav aria-label="Elsewhere">'));
});

it('puts the legal line after the nav', () => {
  expect(footer.indexOf('<p class="closing-legal">')).toBeGreaterThan(footer.indexOf('<nav aria-label="Elsewhere">'));
});

it('keeps Work with me in the links only when there is no button', () => {
  expect(footer).toMatch(/variant === 'quiet' && <a href=\{hireHref\}>Work with me<\/a>/);
});

it('mutes the footer nav links', () => {
  expect(footer).toMatch(/\.compact-footer nav a \{[^}]*color: var\(--muted\);/);
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

const quiet = ['src/pages/index.astro', 'src/pages/privacy.astro', 'src/pages/404.astro', 'src/pages/software/start.astro', 'src/components/audio/AudioFooter.astro'];
const invitation = ['src/pages/building.astro', 'src/pages/writing/index.astro', 'src/pages/writing/ai-gives-you-speed.astro', 'src/layouts/ProjectLayout.astro'];

it('gives quiet pages the quiet panel', () => {
  for (const path of quiet) expect(read(path), path).toMatch(/<Footer variant="quiet"( slot="footer")? \/>/);
});

it('gives invitation pages the default panel', () => {
  for (const path of invitation) expect(read(path), path).toContain('<Footer slot="footer" />');
});

it('moves the Work and About endings into the panel, word for word', () => {
  expect(read('src/pages/work.astro')).toContain('<Footer heading="Have a problem worth exploring?" line="I’d love to hear about it." buttonLabel="Get in touch" buttonPath="/#contact" slot="footer" />');
  expect(read('src/pages/about.astro')).toContain('<Footer id="contact" heading="Let’s talk." line="An idea, a shared interest, or an opportunity worth discussing." buttonLabel="Get in touch" buttonPath="/#contact" slot="footer" />');
});

it('removes page-connect and the compact prop everywhere', () => {
  expect(global).not.toContain('page-connect');
  for (const path of [...quiet, ...invitation, 'src/pages/work.astro', 'src/pages/about.astro']) {
    expect(read(path), path).not.toContain('page-connect');
    expect(read(path), path).not.toMatch(/<Footer[^>]* compact/);
  }
});

it('keeps Home’s contact section and About’s resume request', () => {
  expect(read('src/pages/index.astro')).toContain('<section id="contact" class="site-section contact-section"');
  expect(read('src/pages/about.astro')).toContain('<details id="resumes" class="resume-section context-disclosure">');
});

it('does not stack bottom padding above the panel on Privacy', () => {
  const privacy = read('src/pages/privacy.astro');
  expect(privacy).toContain('<article class="site-shell pt-16">');
  expect(privacy).not.toContain('py-16');
});

it('uses ink for readable footer link hover text on the panel', () => {
  expect(footer).toMatch(/\.compact-footer nav a:hover \{ color: var\(--ink\); \}/);
  expect(footer).not.toMatch(/nav a:hover \{ color: var\(--accent\)/);
});
