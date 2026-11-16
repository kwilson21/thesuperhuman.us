# Closing Panel and Pill Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per the owner's rule for this repository, Haiku 5.5 subagents write the code, tests first, and independent Sonnet 5.5 or Opus 5.5 subagents review each round (one for correctness and security, one for UI, copy and repo rules) until a round is clean.

**Goal:** Every page that renders the shared footer ends on one soft, tinted panel, and every action button on the site is a pill.

**Architecture:** Three new tokens in `src/styles/global.css` (`--panel`, `--radius-panel`, `--radius-button`). The pill rule is a radius change on existing button rules, driven by `--radius-button`. `src/components/Footer.astro` keeps its file, landmark and class names and gains two variants (`invitation`, `quiet`) chosen by props; pages pass props, and Work and About hand their closing sections to it.

**Tech Stack:** Astro 5, Tailwind v4 with plain CSS in `global.css` and page stylesheets, Vitest source-string tests in `tests/components/`, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-12-closing-panel-and-pill-buttons-design.md`. Read it first. Where this plan and the spec disagree, stop and report.

## Global Constraints

- Work on the current branch in this worktree. Never push to or merge into `main`; merging deploys production (AGENTS.md, Website deployment gate).
- No new colours, typefaces or motion. Declarations reference tokens, never raw hex.
- Every button radius comes from `var(--radius-button)`. Fields, selects, textareas, pictures, cards, tabs, toggles and player controls keep their current corners.
- Copy: curly apostrophes (’), no em dashes, no rates. Use the exact strings in this plan.
- Keep the class names `.compact-footer` and `.footer-name`, the `<footer>` element, and `aria-label="Elsewhere"` on the footer nav.
- Hover styles stay inside `(hover: hover) and (pointer: fine)`. Focus, active and disabled states do not change.
- Before each commit: `pnpm run check` and `pnpm test`. Before the PR: `pnpm run build` (it runs the asset, copy, design and publicist checks).
- Do not edit `.agents/skills/hallmark/`, `docs/superpowers/specs/` files other than the spec named above, email templates, or the signed PDF code.

## Review Focus

1. A button whose label is long (for example "Send and move to mixing" on a narrow phone) must not overflow its container once `white-space: nowrap` applies. Expected: the button stays inside the page gutter at 390px wide.
2. A full-width phone button (services hub, intake) stays a pill and keeps its 44px height.
3. The quiet panel on a page with very little content (404) must not sit against the header. Expected: `--site-section-space` above it, as on other pages.
4. Printing a page that hides `.compact-footer` must still hide the whole panel.
5. With JavaScript off and with reduced motion, the panel shows complete, with no `data-reveal` on it.

Tests for 1, 2 and 4 are in Tasks 1 and 3. Items 3 and 5 are checked in the Task 5 screenshots and by the UI reviewer.

---

### Task 1: Tokens, the pill rule on `.site-button`, and the design.md amendment

**Files:**
- Modify: `src/styles/global.css` (the `:root` token block; the `.site-button` rules near line 247)
- Modify: `src/components/WorkWithMe.astro:32` (`.door-art` background)
- Modify: `design.md`
- Create: `tests/components/pill-buttons.test.ts`

**Interfaces:**
- Produces: tokens `--panel`, `--radius-panel`, `--radius-button`; class `.site-button-large`. Tasks 2 and 3 use all four by these names.

- [ ] **Step 1: Commit the approved spec and this plan**

```bash
git add docs/superpowers/specs/2026-11-12-closing-panel-and-pill-buttons-design.md docs/superpowers/plans/2026-11-12-closing-panel-and-pill-buttons.md
git commit -m "Add closing panel and pill buttons brief and plan"
```

- [ ] **Step 2: Write the failing tests** in `tests/components/pill-buttons.test.ts`. Copy the `rgb`, `token` and `luminance` helpers from `tests/components/field-border-contrast.test.ts`.

```ts
it('declares the panel and radius tokens', () => {
  expect(global).toContain('--panel: color-mix(in srgb, var(--rule) 50%, var(--paper));');
  expect(global).toContain('--radius-panel: 32px;');
  expect(global).toContain('--radius-button: 999px;');
});

it('makes the shared button a pill that never wraps', () => {
  const css = global.slice(global.indexOf('.site-button {'), global.indexOf('}', global.indexOf('.site-button {')) + 1);
  expect(css).toContain('border-radius: var(--radius-button);');
  expect(css).toContain('padding: .55rem 1.5rem;');
  expect(css).toContain('white-space: nowrap;');
  expect(css).toContain('min-height: 44px;');
  expect(css).toContain('max-width: 100%;');
});

it('adds the large size used in the closing panel', () => {
  expect(global).toMatch(/\.site-button-large \{[^}]*min-height: 52px;[^}]*font-size: 1\.0625rem;[^}]*padding-inline: 1\.75rem;/);
});

it('keeps text and the focus ring readable on the panel', () => {
  const paper = token('paper'); const ruleColour = token('rule');
  const panel = paper.map((c, i) => (c + ruleColour[i]) / 2);
  const ratio = (name: string) => { const [l, d] = [luminance(panel), luminance(token(name))].sort((a, b) => b - a); return (l + 0.05) / (d + 0.05); };
  expect(ratio('ink')).toBeGreaterThanOrEqual(15);
  expect(ratio('muted')).toBeGreaterThanOrEqual(7);
  expect(ratio('accent')).toBeGreaterThanOrEqual(3);
});

it('draws the door art with the panel token', () => {
  expect(read('src/components/WorkWithMe.astro')).toContain('background: var(--panel);');
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `pnpm test tests/components/pill-buttons.test.ts`
Expected: FAIL, tokens not found.

- [ ] **Step 4: Implement.** Add the three tokens to `:root` in `global.css`. In `.site-button`: replace `border-radius: 3px` with `var(--radius-button)`, change padding to `.55rem 1.5rem`, add `white-space: nowrap; max-width: 100%;`. Add `.site-button-large { min-height: 52px; font-size: 1.0625rem; padding-inline: 1.75rem; gap: .6rem; }` and, inside the existing fine-pointer hover block, `.site-button-large:hover span { transform: translateX(3px); }` with the same transition and reduced-motion handling `.site-link span` has. Change `.door-art` to `background: var(--panel)`. If a page stylesheet overrides `.site-button` padding or radius (`service-pages.css`, `audio-intake.css`, `WorkWithMe.astro`), keep its padding and remove any radius override.

- [ ] **Step 5: Amend `design.md`**
  - Tokens block: add the three tokens with one-line comments.
  - CTA voice, Primary: replace "3px radius" with "pill (`--radius-button`)"; add "Large size, `.site-button-large`, 52px, in the closing panel only." Secondary: note `.site-button-outline` is a pill too.
  - Layout: add "Every page with the shared footer ends on the closing panel (`--panel`, `--radius-panel`). It is the site's one soft surface; no other panel, card or field takes a large radius without an owner decision."
  - States, Fields: unchanged (3px).
  - Add a section `## Owner decisions (November 12, 2026)` quoting "I really like B" and "Pills on every button", and pointing to the spec path.

- [ ] **Step 6: Run the checks**

Run: `pnpm test && pnpm run check && pnpm run design:check`
Expected: all pass. If `tests/components/type-roles.test.ts` or another test asserts the old padding or radius string, update that assertion to the new value.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Make site buttons pills and add panel tokens"
```

### Task 2: Button inventory and pills on the remaining action buttons

**Files:**
- Create: `docs/design-concepts/2026-11-12/button-inventory.md`
- Modify: `src/styles/studio.css` (`.studio-button`), `src/styles/owner.css` (`.owner-primary-action`), `src/styles/audio-intake.css` (`.intake-actions [data-back]`), `src/pages/owner/requests/[id].astro:164` (`.rail-actions button`), plus any "pill" rows the inventory finds
- Modify: `tests/components/pill-buttons.test.ts`

**Interfaces:**
- Consumes: `--radius-button` from Task 1.

- [ ] **Step 1: Write the inventory.** Search `src/` for every rule that styles a `button`, `[type=submit]`, or an `a` drawn as a button. Record each in a table: selector, file, what it does, group. Groups, by the spec's rule: **pill** (a filled or outlined rectangle with a text label that submits, continues, goes back, sends, approves or leads somewhere), **stays** (tabs, switches, toggles, player and volume controls, text-style buttons with no border or fill, the video poster button, drop zones, buttons inside illustrations, icon-only buttons), **unsure**.

- [ ] **Step 2: Stop if "unsure" is not empty.** Report the unsure rows to the coordinator, who takes them to the owner with screenshots. Do not change an unsure button. Continue with the pill rows.

- [ ] **Step 3: Write the failing tests**

```ts
it('uses the button radius token on every pill in the inventory', () => {
  expect(read('src/styles/studio.css')).toMatch(/\.studio-button \{[^}]*border-radius: var\(--radius-button\);/);
  expect(read('src/styles/owner.css')).toMatch(/\.owner-primary-action\{[^}]*border-radius:var\(--radius-button\)/);
  expect(read('src/styles/audio-intake.css')).toMatch(/\.intake-actions \[data-back\]\{[^}]*border-radius:var\(--radius-button\)/);
  expect(read('src/pages/owner/requests/[id].astro')).toMatch(/\.rail-actions button \{[^}]*border-radius: var\(--radius-button\);/);
});

it('leaves fields square', () => {
  expect(global).not.toMatch(/\.site-form (input|textarea|select)[^{]*\{[^}]*var\(--radius-button\)/);
});
```

Add one `toMatch` line per extra pill row from the inventory, in the same form.

- [ ] **Step 4: Run it and see it fail**

Run: `pnpm test tests/components/pill-buttons.test.ts`
Expected: FAIL on the four selectors.

- [ ] **Step 5: Implement.** Set `border-radius: var(--radius-button)` on each pill row. Add `white-space: nowrap` where the rule has none. Raise inline padding only where the label would touch the curve (under 1.2rem); `.owner-primary-action` goes to `.65rem 1.25rem`.

- [ ] **Step 6: Run the checks**

Run: `pnpm test && pnpm run check && pnpm run design:check`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Apply pill shape to studio, owner and intake action buttons"
```

### Task 3: The closing panel in `Footer.astro`

**Files:**
- Modify: `src/components/Footer.astro`
- Create: `tests/components/closing-panel.test.ts`
- Modify: `tests/components/homepage-cta.test.ts:21-22`

**Interfaces:**
- Consumes: `--panel`, `--radius-panel`, `.site-button`, `.site-button-large` from Task 1.
- Produces, for Task 4:

```ts
interface Props {
  variant?: 'invitation' | 'quiet';   // default 'invitation'
  heading?: string;                   // default 'Let’s work together.'
  line?: string;                      // default 'Every project is fixed price and agreed in writing before work begins.'
  buttonLabel?: string;               // default 'Work with me'
  buttonPath?: string;                // main-site path, resolved with mainHref; default '/services'
  id?: string;                        // set on the panel element
}
```

The `compact` prop is removed.

- [ ] **Step 1: Write the failing tests** in `tests/components/closing-panel.test.ts`, reading `src/components/Footer.astro` as a string.

```ts
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
```

In `tests/components/homepage-cta.test.ts`, replace the last assertion with `expect(footer).toContain("variant === 'quiet' && <a href={hireHref}>Work with me</a>");`.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm test tests/components/closing-panel.test.ts tests/components/homepage-cta.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Markup order inside `<footer class="compact-footer site-shell">`: `<div class:list={['closing-panel', { 'closing-panel--quiet': variant === 'quiet' }]} id={id}>`, then the name mark link (`.footer-name`), then the invitation block (heading, line, button), then the nav (GitHub, LinkedIn, Audio, Work with me in quiet only, Support my work, Privacy), then `<p class="closing-legal">The Superhuman Group LLC · {year}</p>`. The panel is a centred single column (`display: grid; justify-items: center; text-align: center`). Space between items: name to heading 1.6rem, heading to line .9rem, line to button 1.9rem, button to nav 3.25rem, nav to legal 1rem; in the quiet variant name to nav 1.25rem. Nav links: `.875rem`, `var(--muted)`, wrapping, centred, with the existing 44px tap-area pseudo-element and row gap `calc(44px - 1lh)`. Remove the old `.compact-footer-inner` rules, including its top border.

- [ ] **Step 4: Run the checks**

Run: `pnpm test && pnpm run check && pnpm run design:check`
Expected: `astro check` fails on callers that still pass `compact`. That is expected and fixed in Task 4. All Vitest tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Turn the footer into the closing panel"
```

### Task 4: Give each page its variant

**Files:**
- Modify: `src/pages/index.astro:130`, `src/pages/privacy.astro:41`, `src/pages/404.astro:52`, `src/pages/software/start.astro:114`, `src/components/audio/AudioFooter.astro:4` (quiet)
- Modify: `src/pages/building.astro:54`, `src/pages/writing/index.astro:28`, `src/pages/writing/ai-gives-you-speed.astro:37`, `src/layouts/ProjectLayout.astro:41` (default invitation)
- Modify: `src/pages/work.astro:41-42`, `src/pages/about.astro:36-39`
- Modify: `src/styles/global.css` (remove the three `.page-connect` rules and `.page-connect > .site-button`)
- Modify: `tests/components/closing-panel.test.ts`

**Interfaces:**
- Consumes: the `Props` of Task 3.

- [ ] **Step 1: Write the failing tests**

```ts
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
  expect(global).not.toContain('.page-connect');
  for (const path of [...quiet, ...invitation, 'src/pages/work.astro', 'src/pages/about.astro']) {
    expect(read(path), path).not.toContain('page-connect');
    expect(read(path), path).not.toMatch(/<Footer[^>]* compact/);
  }
});

it('keeps Home’s contact section and About’s resume request', () => {
  expect(read('src/pages/index.astro')).toContain('<section id="contact" class="site-section contact-section"');
  expect(read('src/pages/about.astro')).toContain('<details id="resumes" class="resume-section context-disclosure">');
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm test tests/components/closing-panel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Replace each `<Footer compact .../>` as the tests state. In `work.astro` and `about.astro`, delete the `.page-connect` section. In `about.astro` the resume `<details>` stays where it is, now the last item before the panel; keep the space above it that the removed section's `margin-top: var(--site-section-space)` provided by giving `.resume-section` that margin and a `border-top: 1px solid var(--rule)` with `padding-top: 2.5rem`. Remove the `.page-connect` rules from `global.css`. On each page, check the last section adds no bottom margin or padding that stacks with the footer's `margin-top`; where it does, remove the page's one.

- [ ] **Step 4: Run the checks**

Run: `pnpm test && pnpm run check && pnpm run design:check && pnpm run copy:check`
Expected: all pass, `astro check` with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Give each page its closing panel variant"
```

### Task 5: Verify, review and open the PR

**Files:** none new, apart from fixes the checks ask for.

- [ ] **Step 1: Full build**

Run: `pnpm run build`
Expected: exits 0, including the asset, copy, design and publicist checks.

- [ ] **Step 2: Look at the pages.** Run `pnpm run screenshots:preview` then `pnpm run screenshots` (see `scripts/screenshots/README.md`). Inspect every page at 1280×800 and 390×844. Check each Review Focus item: no button overflows at 390px; full-width phone buttons are pills; the 404's panel has `--site-section-space` above it; the panel shows without JavaScript. Open the print preview of `/software/start` and confirm the footer is hidden.

- [ ] **Step 3: Hallmark audit.** Run `hallmark audit` read-only on the changed pages (`docs/design-standard.md`). Fix defects. Send design-choice findings to the coordinator for the owner; do not change them.

- [ ] **Step 4: Review rounds.** Two independent reviewers on the branch diff: one for correctness and security, one for UI, copy, `design.md` and the rules in `CLAUDE.md`. Verify each finding against the code, fix the real ones, and repeat until a round finds nothing.

- [ ] **Step 5: Open the PR.** Push the branch, open a ready-for-review PR following the PR template, list the button inventory and any unsure rows, and confirm the Screenshots workflow wrote its images into the description. Greptile and Codex review on the PR. Do not merge: the owner has approved the brief, not the built look, and merging deploys production.
