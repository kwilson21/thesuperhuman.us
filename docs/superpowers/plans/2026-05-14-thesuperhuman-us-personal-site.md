# thesuperhuman.us Personal Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a content-forward personal site at thesuperhuman.us — an editorial-styled Astro static site on Cloudflare Pages with a TDD'd contact form Pages Function backed by Resend, Turnstile, and KV rate limiting.

**Architecture:** Astro 5.x with the Cloudflare adapter outputs static HTML for `/` and `/about` and a single Pages Function at `/api/contact`. Content lives in a markdown content collection rendered with editorial typography (Newsreader serif + Inter UI). Form submissions are validated server-side, gated by Cloudflare Turnstile, rate-limited via Cloudflare KV, and dispatched through Resend with an autoresponder to the visitor.

**Tech Stack:** Astro 5.x · TypeScript · Tailwind CSS · @astrojs/cloudflare · @astrojs/sitemap · Resend (email) · Cloudflare Turnstile (spam) · Cloudflare KV (rate limit) · Vitest (unit tests).

**Source spec:** [docs/superpowers/specs/2026-05-14-thesuperhuman-us-personal-site-design.md](../specs/2026-05-14-thesuperhuman-us-personal-site-design.md)

---

## File map

**Created during this plan:**

| Path | Responsibility |
|---|---|
| `package.json` | dependencies, scripts |
| `astro.config.mjs` | Astro config, Cloudflare adapter, sitemap |
| `tailwind.config.mjs` | Tailwind + design tokens |
| `tsconfig.json` | TS config (Astro's strict preset) |
| `vitest.config.ts` | Vitest config for backend unit tests |
| `README.md` | brief project doc |
| `src/styles/global.css` | tokens, base typography, drop cap |
| `src/layouts/BaseLayout.astro` | `<head>`, fonts, skip link, JSON-LD, footer slot |
| `src/components/Hero.astro` | landing hero (text + headshot) |
| `src/components/WhatIDo.astro` | 4-bullet capability list |
| `src/components/ProjectCard.astro` | a single project card |
| `src/components/ExperienceRow.astro` | a single experience row |
| `src/components/Footer.astro` | three-column footer |
| `src/components/ContactForm.astro` | the intake form + submit JS |
| `src/components/ResumeCard.astro` | a single resume chooser card |
| `src/content/config.ts` | content collection schemas |
| `src/content/pages/about.md` | bio (moved from `kazon-personal-site.md`) |
| `src/pages/index.astro` | landing page |
| `src/pages/about.astro` | about page renderer |
| `src/pages/api/contact.ts` | Pages Function — contact form backend |
| `src/lib/validation.ts` | input validation for `/api/contact` |
| `src/lib/turnstile.ts` | Turnstile siteverify wrapper |
| `src/lib/rate-limit.ts` | KV-backed per-IP rate limiter |
| `src/lib/resend.ts` | Resend wrapper (primary + autoresponder) |
| `tests/lib/validation.test.ts` | validation unit tests |
| `tests/lib/turnstile.test.ts` | Turnstile wrapper tests |
| `tests/lib/rate-limit.test.ts` | rate-limit tests with in-memory KV stub |
| `tests/lib/resend.test.ts` | Resend wrapper tests |
| `tests/api/contact.test.ts` | contact endpoint integration tests |
| `public/headshot.jpg` | optimized portrait (moved from `IMG_2285.jpeg`) |
| `public/resumes/general.pdf` | resume PDFs |
| `public/resumes/leadership.pdf` | |
| `public/resumes/dod.pdf` | |
| `public/favicon.svg` | site favicon |
| `public/og-image.png` | 1200×630 social card |
| `public/robots.txt` | crawler directives |

**Modified during this plan:**

| Path | Change |
|---|---|
| `.gitignore` | add `dist/`, `.astro/`, `.dev.vars`, `coverage/` (some already present) |
| `kazon-personal-site.md` | deleted (moved to `src/content/pages/about.md`) |
| `IMG_2285.jpeg` | deleted (moved to `public/headshot.jpg`) |

---

## Task 1: Scaffold the Astro project

**Files:**
- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`, `src/pages/index.astro` (placeholder), `src/env.d.ts`
- Modify: none

- [ ] **Step 1: Initialize package.json**

Create `package.json`:

```json
{
  "name": "thesuperhuman-us",
  "type": "module",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "start": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@astrojs/check": "^0.9.4",
    "@astrojs/cloudflare": "^11.2.0",
    "@astrojs/sitemap": "^3.2.1",
    "@astrojs/tailwind": "^5.1.4",
    "astro": "^5.1.0",
    "resend": "^4.0.1",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241218.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: Dependencies installed; `node_modules/` created.

- [ ] **Step 3: Create astro.config.mjs**

Create `astro.config.mjs`:

```js
// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://thesuperhuman.us',
  output: 'static',
  adapter: cloudflare({
    imageService: 'compile',
    platformProxy: { enabled: true },
  }),
  integrations: [tailwind({ applyBaseStyles: false }), sitemap()],
});
```

- [ ] **Step 4: Create tsconfig.json**

Create `tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"],
    "baseUrl": ".",
    "paths": { "~/*": ["src/*"] }
  },
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 5: Create src/env.d.ts**

Create `src/env.d.ts`:

```ts
/// <reference path="../.astro/types.d.ts" />

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}

interface Env {
  RESEND_API_KEY: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  CONTACT_TO_EMAIL: string;
  CONTACT_FROM_EMAIL: string;
  RATE_LIMIT: KVNamespace;
}
```

- [ ] **Step 6: Create a placeholder index.astro to verify build**

Create `src/pages/index.astro`:

```astro
---
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>thesuperhuman.us</title>
  </head>
  <body><p>scaffold ok</p></body>
</html>
```

- [ ] **Step 7: Verify build succeeds**

Run: `npm run build`
Expected: Build completes; `dist/index.html` exists; no errors.

- [ ] **Step 8: Update .gitignore**

Append to `.gitignore`:

```
dist/
.astro/
coverage/
.dev.vars
```

(The file already contains `.claude/`, `.superpowers/`, `node_modules/`, etc. — keep those.)

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json astro.config.mjs tsconfig.json src/env.d.ts src/pages/index.astro .gitignore
git commit -m "Scaffold Astro project with Cloudflare and Tailwind"
```

---

## Task 2: Configure Tailwind and design tokens

**Files:**
- Create: `tailwind.config.mjs`, `src/styles/global.css`
- Modify: none

- [ ] **Step 1: Create tailwind.config.mjs**

Create `tailwind.config.mjs`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        rule: 'var(--rule)',
        accent: 'var(--accent)',
      },
      fontFamily: {
        serif: ['Newsreader', 'Iowan Old Style', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      maxWidth: {
        measure: '38rem',
        content: '42.5rem',
        page: '64rem',
      },
      letterSpacing: {
        eyebrow: '0.12em',
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: Create global.css with tokens, base type, and drop cap**

Create `src/styles/global.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --paper: #FBF8F2;
  --ink: #0E0E0E;
  --muted: #4A4A4A;
  --rule: #E8E3DA;
  --accent: #B85C38;
}

@layer base {
  html {
    background: var(--paper);
    color: var(--ink);
    font-family: theme('fontFamily.serif');
    font-size: 16px;
    line-height: 1.6;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
  }

  body {
    min-height: 100vh;
  }

  h1, h2, h3 {
    font-family: theme('fontFamily.serif');
    color: var(--ink);
    letter-spacing: -0.01em;
    font-weight: 400;
  }

  a {
    color: var(--ink);
    text-decoration: none;
    border-bottom: 1px solid var(--accent);
    padding-bottom: 1px;
  }

  a:hover {
    color: var(--accent);
  }

  *:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 2px;
  }
}

@layer components {
  .eyebrow {
    font-family: theme('fontFamily.sans');
    font-size: 11px;
    letter-spacing: theme('letterSpacing.eyebrow');
    text-transform: uppercase;
    font-weight: 500;
    color: var(--muted);
  }

  .display {
    font-size: 2.5rem;
    line-height: 1.08;
    letter-spacing: -0.018em;
  }

  @media (min-width: 768px) {
    .display { font-size: 3rem; }
  }

  .heading {
    font-size: 1.75rem;
    line-height: 1.2;
  }

  .lede {
    font-size: 1.25rem;
    line-height: 1.5;
  }

  .btn-primary {
    display: inline-block;
    background: var(--ink);
    color: var(--paper);
    font-family: theme('fontFamily.sans');
    font-size: 13px;
    font-weight: 500;
    padding: 11px 22px;
    border-radius: 5px;
    border-bottom: none;
  }

  .btn-primary:hover {
    background: var(--accent);
    color: var(--paper);
  }

  .skip-link {
    position: absolute;
    left: -9999px;
    top: 0;
    background: var(--ink);
    color: var(--paper);
    padding: 8px 16px;
    z-index: 100;
  }

  .skip-link:focus {
    left: 16px;
    top: 16px;
  }

  /* Drop cap for the first paragraph of /about */
  .prose-about > p:first-of-type::first-letter {
    float: left;
    font-family: theme('fontFamily.serif');
    font-size: 4.5rem;
    line-height: 0.85;
    font-weight: 400;
    padding-right: 0.5rem;
    padding-top: 0.4rem;
    color: var(--ink);
  }
}
```

- [ ] **Step 3: Verify build with tokens in place**

Run: `npm run build`
Expected: Build completes; `dist/index.html` includes Tailwind output.

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.mjs src/styles/global.css
git commit -m "Configure Tailwind and editorial design tokens"
```

---

## Task 3: Build BaseLayout with fonts, head, and skip link

**Files:**
- Create: `src/layouts/BaseLayout.astro`
- Modify: none

- [ ] **Step 1: Create BaseLayout.astro**

Create `src/layouts/BaseLayout.astro`:

```astro
---
import '~/styles/global.css';

interface Props {
  title: string;
  description: string;
  ogImage?: string;
  jsonLd?: object;
}

const { title, description, ogImage = '/og-image.png', jsonLd } = Astro.props;
const canonical = new URL(Astro.url.pathname, Astro.site).toString();
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={canonical} />

    <meta property="og:type" content="website" />
    <meta property="og:url" content={canonical} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:image" content={new URL(ogImage, Astro.site).toString()} />
    <meta name="twitter:card" content="summary_large_image" />

    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="sitemap" href="/sitemap-index.xml" />

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
    />

    {jsonLd && (
      <script type="application/ld+json" set:html={JSON.stringify(jsonLd)} />
    )}
  </head>
  <body class="bg-paper text-ink font-serif">
    <a href="#main" class="skip-link">Skip to content</a>
    <main id="main">
      <slot />
    </main>
    <slot name="footer" />
  </body>
</html>
```

- [ ] **Step 2: Update placeholder index.astro to use the layout**

Replace `src/pages/index.astro` with:

```astro
---
import BaseLayout from '~/layouts/BaseLayout.astro';
---
<BaseLayout
  title="Kazon Wilson — Software engineer"
  description="Backend and data engineer. Available for contract work through The Superhuman Group LLC."
>
  <p class="p-8">Scaffold OK · BaseLayout active</p>
</BaseLayout>
```

- [ ] **Step 3: Verify dev server renders**

Run: `npm run dev`
Open: `http://localhost:4321`
Expected: paper background, ink text, "Scaffold OK · BaseLayout active". Inspect: serif font (Newsreader) loaded, skip link present in DOM. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/layouts/BaseLayout.astro src/pages/index.astro
git commit -m "Add BaseLayout with fonts, head meta, and skip link"
```

---

## Task 4: Set up content collection and move the bio markdown

**Files:**
- Create: `src/content/config.ts`, `src/content/pages/about.md`
- Modify: delete `kazon-personal-site.md` from repo root

- [ ] **Step 1: Create content collection schema**

Create `src/content/config.ts`:

```ts
import { defineCollection, z } from 'astro:content';

const pages = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

const notes = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { pages, notes };
```

- [ ] **Step 2: Move the bio markdown into the collection**

Run:

```bash
mkdir -p src/content/pages src/content/notes
git mv kazon-personal-site.md src/content/pages/about.md
```

- [ ] **Step 3: Add frontmatter to about.md**

Edit `src/content/pages/about.md` — prepend frontmatter at the very top before the existing `# Kazon Wilson` line:

```markdown
---
title: "About — Kazon Wilson"
description: "Software engineer based in Connecticut, soon Northern Virginia. Backend and data systems, with side trips through Ruby on Rails and TypeScript."
---

```

Leave the rest of the file unchanged.

- [ ] **Step 4: Verify Astro picks up the collection**

Run: `npm run check`
Expected: No type errors; the `about` entry in the `pages` collection is recognized.

- [ ] **Step 5: Commit**

```bash
git add src/content/config.ts src/content/pages/about.md
git commit -m "Set up content collection and move bio into about.md"
```

---

## Task 5: Render the About page

**Files:**
- Create: `src/pages/about.astro`
- Modify: none

- [ ] **Step 1: Create the About page**

Create `src/pages/about.astro`:

```astro
---
import { getEntry } from 'astro:content';
import BaseLayout from '~/layouts/BaseLayout.astro';
import Footer from '~/components/Footer.astro';

const entry = await getEntry('pages', 'about');
if (!entry) throw new Error('about content missing');
const { Content } = await entry.render();

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Kazon Wilson',
  jobTitle: 'Software Engineer',
  url: 'https://thesuperhuman.us',
  sameAs: [
    'https://github.com/kwilson21',
    'https://www.linkedin.com/in/kazonwilson/',
  ],
  worksFor: { '@type': 'Organization', name: 'The Superhuman Group LLC' },
};
---
<BaseLayout
  title={entry.data.title}
  description={entry.data.description}
  jsonLd={jsonLd}
>
  <article class="mx-auto max-w-content px-6 py-16 md:py-24">
    <header class="mb-12 flex items-start gap-6">
      <img
        src="/headshot.jpg"
        alt="Kazon Wilson"
        width="120"
        height="150"
        class="w-24 md:w-32 aspect-[4/5] object-cover object-[center_25%] rounded-sm"
      />
      <div>
        <h1 class="display mb-2">Kazon Wilson</h1>
        <p class="text-muted text-sm md:text-base">
          Software engineer · Fairfield, CT → Northern Virginia · Available for contract work.
        </p>
      </div>
    </header>

    <div class="prose-about prose-editorial">
      <Content />
    </div>
  </article>

  <Footer slot="footer" />
</BaseLayout>

<style is:global>
  .prose-editorial { font-family: theme('fontFamily.serif'); color: var(--ink); }
  .prose-editorial > * + * { margin-top: 1.5em; }
  .prose-editorial h2 { font-size: 1.75rem; margin-top: 3rem; padding-top: 2rem; border-top: 1px solid var(--rule); }
  .prose-editorial h3 { font-size: 1.25rem; margin-top: 2rem; font-weight: 500; }
  .prose-editorial p { font-size: 1.0625rem; line-height: 1.65; max-width: 38rem; }
  .prose-editorial p em { font-style: italic; }
  .prose-editorial strong { font-weight: 600; }
  .prose-editorial hr { border: 0; border-top: 1px solid var(--rule); margin: 3rem 0; max-width: 38rem; }
  .prose-editorial ul { padding-left: 1.25rem; max-width: 38rem; }
  .prose-editorial li { font-size: 1.0625rem; line-height: 1.65; }
  .prose-editorial a { border-bottom: 1px solid var(--accent); }
</style>
```

- [ ] **Step 2: Create a placeholder Footer to make the import resolve**

Create `src/components/Footer.astro`:

```astro
---
---
<footer class="border-t border-rule mt-24 px-6 py-10 text-sm text-muted">
  <div class="mx-auto max-w-page">Footer placeholder — to be built in Task 12.</div>
</footer>
```

- [ ] **Step 3: Add a temporary headshot copy so the About page renders**

Run:

```bash
mkdir -p public
cp IMG_2285.jpeg public/headshot.jpg
```

(This is temporary; Task 7 moves the original file properly.)

- [ ] **Step 4: Verify the About page renders**

Run: `npm run dev`
Open: `http://localhost:4321/about`
Expected: Headshot at the top-left, name + subtitle to its right, bio prose rendered with editorial typography, drop cap on the first paragraph, `## Selected work` rendered with a top rule.

- [ ] **Step 5: Commit**

```bash
git add src/pages/about.astro src/components/Footer.astro public/headshot.jpg
git commit -m "Render /about from content collection with editorial type"
```

---

## Task 6: Add resume PDFs and build the ResumeCard component

**Files:**
- Create: `public/resumes/general.pdf`, `public/resumes/leadership.pdf`, `public/resumes/dod.pdf`, `src/components/ResumeCard.astro`
- Modify: `src/pages/about.astro`

- [ ] **Step 1: Copy and rename the three resume PDFs**

Run:

```bash
mkdir -p public/resumes
cp "/Users/kazon/Downloads/Resumes 2026/KWilson_Resume_G_2026.pdf" public/resumes/general.pdf
cp "/Users/kazon/Downloads/Resumes 2026/KWilson_Resume_L_2026.pdf" public/resumes/leadership.pdf
cp "/Users/kazon/Downloads/Resumes 2026/KWilson_Resume_D_2026.pdf" public/resumes/dod.pdf
ls -la public/resumes/
```

Expected: three PDFs in `public/resumes/`.

- [ ] **Step 2: Create ResumeCard component**

Create `src/components/ResumeCard.astro`:

```astro
---
interface Props {
  title: string;
  audience: string;
  description: string;
  href: string;
  sizeKb: number;
}
const { title, audience, description, href, sizeKb } = Astro.props;
---
<a
  href={href}
  download
  class="block border border-rule bg-paper p-6 rounded-sm hover:border-accent transition-colors"
  style="border-bottom-width: 1px;"
>
  <div class="eyebrow mb-3">{audience}</div>
  <h3 class="font-serif text-xl mb-2" style="font-weight: 500;">{title}</h3>
  <p class="text-sm text-muted leading-relaxed mb-4">{description}</p>
  <span class="font-sans text-xs font-medium text-accent">
    Download PDF · {sizeKb} KB →
  </span>
</a>
```

- [ ] **Step 3: Compute file sizes for the cards**

Run:

```bash
ls -l public/resumes/*.pdf | awk '{printf "%s: %d KB\n", $9, int($5/1024 + 0.5)}'
```

Note the three values for the next step (e.g., `general.pdf: 21 KB`).

- [ ] **Step 4: Add the resume chooser section to about.astro**

In `src/pages/about.astro`, add the import at the top of the frontmatter (with the other imports):

```astro
import ResumeCard from '~/components/ResumeCard.astro';
```

Then, just before the closing `</article>` tag, add:

```astro
    <section id="resumes" class="mt-20 pt-16 border-t border-rule">
      <h2 class="font-serif text-3xl mb-2">Resume — pick the one that matches your role</h2>
      <p class="text-muted mb-10 max-w-measure">Three versions, tuned for different audiences.</p>
      <div class="grid gap-5 md:grid-cols-3">
        <ResumeCard
          title="General"
          audience="Hiring for backend, data, or general engineering roles?"
          description="Full work history with technical depth and cross-team contributions."
          href="/resumes/general.pdf"
          sizeKb={21}
        />
        <ResumeCard
          title="Leadership"
          audience="Hiring for staff, principal, or engineering leadership?"
          description="Emphasizes ownership, mentorship, cross-org influence, and AI-assisted development advocacy."
          href="/resumes/leadership.pdf"
          sizeKb={22}
        />
        <ResumeCard
          title="DoD-focused"
          audience="Hiring for federal, defense, or cleared work?"
          description="Tailored for DoD format and contracting context."
          href="/resumes/dod.pdf"
          sizeKb={23}
        />
      </div>
    </section>
```

Replace the `sizeKb` values with the actual sizes computed in Step 3.

- [ ] **Step 5: Verify the resume chooser renders**

Run: `npm run dev`
Open: `http://localhost:4321/about#resumes`
Expected: Three cards in a row on desktop, stacked on mobile. Click one — the PDF downloads (or opens in a new tab depending on the browser).

- [ ] **Step 6: Commit**

```bash
git add public/resumes/ src/components/ResumeCard.astro src/pages/about.astro
git commit -m "Add resume chooser with three audience-targeted cards"
```

---

## Task 7: Move headshot to public/ properly and remove root copy

**Files:**
- Modify: delete `IMG_2285.jpeg` from repo root
- Modify: `public/headshot.jpg` (replaced with optimized version)

- [ ] **Step 1: Re-copy the headshot using the renamed canonical name**

Run:

```bash
cp IMG_2285.jpeg public/headshot.jpg
git rm IMG_2285.jpeg
ls -la public/headshot.jpg
```

Expected: `IMG_2285.jpeg` removed from the repo root; `public/headshot.jpg` is the canonical copy.

- [ ] **Step 2: Verify About page still loads the headshot**

Run: `npm run dev`
Open: `http://localhost:4321/about`
Expected: portrait still renders correctly.

- [ ] **Step 3: Commit**

```bash
git add public/headshot.jpg
git commit -m "Move headshot to public/ as canonical headshot.jpg"
```

---

## Task 8: Build the Hero component for the landing page

**Files:**
- Create: `src/components/Hero.astro`
- Modify: none yet (landing assembly happens in Task 13)

- [ ] **Step 1: Create Hero.astro**

Create `src/components/Hero.astro`:

```astro
---
---
<section class="mx-auto max-w-page px-6 pt-16 pb-20 md:pt-24 md:pb-28">
  <div class="grid gap-10 md:grid-cols-[1.5fr_1fr] md:gap-16 items-start">
    <div>
      <div class="eyebrow flex items-center gap-2 mb-9">
        <span class="inline-block w-1.5 h-1.5 rounded-full" style="background: var(--accent);"></span>
        Available for contract work · 2026
      </div>

      <h1 class="display mb-5">Kazon Wilson</h1>

      <p class="lede max-w-measure mb-4" style="color: #2a2a2a;">
        I'm most useful when a problem cuts <em class="italic">across layers</em> — when a UI bug turns out to be a data pipeline issue that turns out to be a business-logic miscommunication.
      </p>

      <p class="text-base text-muted max-w-measure mb-8">
        Backend &amp; data engineer · 7+ years of production systems · Contracting through The Superhuman Group LLC.
      </p>

      <div class="flex flex-wrap gap-4 items-center">
        <a href="#contact" class="btn-primary" style="border-bottom: none;">Work with me</a>
        <a href="/about" class="text-base">Read more →</a>
      </div>
    </div>

    <div class="order-first md:order-last">
      <img
        src="/headshot.jpg"
        alt="Kazon Wilson"
        width="560"
        height="700"
        class="w-full max-w-[280px] aspect-[4/5] object-cover object-[center_25%] rounded-sm"
        fetchpriority="high"
        loading="eager"
      />
    </div>
  </div>
</section>
```

- [ ] **Step 2: Drop the Hero into a temporary landing for visual check**

Replace `src/pages/index.astro` with:

```astro
---
import BaseLayout from '~/layouts/BaseLayout.astro';
import Hero from '~/components/Hero.astro';
import Footer from '~/components/Footer.astro';
---
<BaseLayout
  title="Kazon Wilson — Software engineer"
  description="Backend and data engineer. Available for contract work through The Superhuman Group LLC."
>
  <Hero />
  <Footer slot="footer" />
</BaseLayout>
```

- [ ] **Step 3: Verify the hero renders**

Run: `npm run dev`
Open: `http://localhost:4321/`
Expected: Hero with eyebrow + rust dot, name, lede, secondary line, two CTAs, headshot at right (top on mobile). Responsive — resize browser to confirm the stack order.

- [ ] **Step 4: Commit**

```bash
git add src/components/Hero.astro src/pages/index.astro
git commit -m "Add Hero component for landing"
```

---

## Task 9: Build WhatIDo, ProjectCard, and ExperienceRow components

**Files:**
- Create: `src/components/WhatIDo.astro`, `src/components/ProjectCard.astro`, `src/components/ExperienceRow.astro`

- [ ] **Step 1: Create WhatIDo.astro**

Create `src/components/WhatIDo.astro`:

```astro
---
const items = [
  {
    title: 'Backend systems',
    body: 'Python, Django, Rails, Postgres. Production reliability and observability are part of the deliverable.',
  },
  {
    title: 'Data pipelines & ETL',
    body: 'Dagster, custom ingestion, messy real-world data sources with undocumented contracts.',
  },
  {
    title: 'Cross-team product work',
    body: 'Interfaces between engineering, ops, and external vendors; migrations and deprecations.',
  },
  {
    title: 'AI-assisted development advocacy',
    body: 'Modeling Claude in feature planning, PR review, and PR description authorship.',
  },
];
---
<section class="mx-auto max-w-content px-6 py-16 md:py-20 border-t border-rule">
  <h2 class="heading mb-10">What I do</h2>
  <div class="space-y-6">
    {items.map(item => (
      <p class="text-[1.0625rem] leading-relaxed max-w-measure">
        <strong class="font-serif" style="font-weight: 600;">{item.title}.</strong>
        <span class="text-ink">{' '}{item.body}</span>
      </p>
    ))}
  </div>
</section>
```

- [ ] **Step 2: Create ProjectCard.astro**

Create `src/components/ProjectCard.astro`:

```astro
---
interface Props {
  name: string;
  url: string;
  description: string;
  stack: string[];
}
const { name, url, description, stack } = Astro.props;
---
<article class="border-t border-rule pt-6 pb-2">
  <h3 class="font-serif text-2xl mb-2">{name}</h3>
  <p class="text-[1.0625rem] leading-relaxed text-ink mb-3 max-w-measure">{description}</p>
  <p class="font-mono text-xs text-muted mb-3">{stack.join(' · ')}</p>
  <a href={url} class="text-sm" target="_blank" rel="noopener">Visit live →</a>
</article>
```

- [ ] **Step 3: Create ExperienceRow.astro**

Create `src/components/ExperienceRow.astro`:

```astro
---
interface Props {
  company: string;
  role: string;
  dates: string;
  outcome: string;
}
const { company, role, dates, outcome } = Astro.props;
---
<div class="border-t border-rule py-5 grid gap-1 md:grid-cols-[1fr_2fr] md:gap-8 items-baseline">
  <div>
    <h3 class="font-serif text-lg" style="font-weight: 500;">{company}</h3>
    <p class="eyebrow mt-1">{role} · {dates}</p>
  </div>
  <p class="text-[1.0625rem] leading-relaxed text-ink max-w-measure">{outcome}</p>
</div>
```

- [ ] **Step 4: Verify the components compile**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/WhatIDo.astro src/components/ProjectCard.astro src/components/ExperienceRow.astro
git commit -m "Add WhatIDo, ProjectCard, and ExperienceRow components"
```

---

## Task 10: Build the Footer component

**Files:**
- Modify: `src/components/Footer.astro` (replace placeholder)

- [ ] **Step 1: Replace Footer.astro with the full version**

Overwrite `src/components/Footer.astro`:

```astro
---
const year = new Date().getFullYear();
---
<footer class="border-t border-rule mt-24">
  <div class="mx-auto max-w-page px-6 py-12">
    <div class="grid gap-8 md:grid-cols-3 text-sm text-muted">
      <div>
        <div class="eyebrow mb-3">Contact</div>
        <p>
          <a href="mailto:kazonwilson@gmail.com" style="color: var(--ink);">kazonwilson@gmail.com</a>
        </p>
        <p class="mt-1">Fairfield, CT → Northern Virginia</p>
      </div>

      <div>
        <div class="eyebrow mb-3">Elsewhere</div>
        <ul class="space-y-1">
          <li>
            <a href="https://github.com/kwilson21" target="_blank" rel="noopener" style="color: var(--ink);">GitHub</a>
          </li>
          <li>
            <a href="https://www.linkedin.com/in/kazonwilson/" target="_blank" rel="noopener" style="color: var(--ink);">LinkedIn</a>
          </li>
        </ul>
      </div>

      <div>
        <div class="eyebrow mb-3">Identity</div>
        <p>The Superhuman Group LLC</p>
        <p class="mt-1">© {year}</p>
      </div>
    </div>
  </div>
</footer>
```

- [ ] **Step 2: Verify the footer renders on both pages**

Run: `npm run dev`
Open `http://localhost:4321/` and `http://localhost:4321/about`.
Expected: three-column footer at the bottom, stacked on mobile, with links that work.

- [ ] **Step 3: Commit**

```bash
git add src/components/Footer.astro
git commit -m "Build full Footer with contact, social, and identity columns"
```

---

## Task 11: Assemble the landing page

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Replace index.astro with the full assembly**

Overwrite `src/pages/index.astro`:

```astro
---
import BaseLayout from '~/layouts/BaseLayout.astro';
import Hero from '~/components/Hero.astro';
import WhatIDo from '~/components/WhatIDo.astro';
import ProjectCard from '~/components/ProjectCard.astro';
import ExperienceRow from '~/components/ExperienceRow.astro';
import Footer from '~/components/Footer.astro';

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Kazon Wilson',
  jobTitle: 'Software Engineer',
  url: 'https://thesuperhuman.us',
  sameAs: [
    'https://github.com/kwilson21',
    'https://www.linkedin.com/in/kazonwilson/',
  ],
  worksFor: { '@type': 'Organization', name: 'The Superhuman Group LLC' },
};
---
<BaseLayout
  title="Kazon Wilson — Backend & data engineer, available for contract work"
  description="Backend and data engineer with 7+ years of production systems. Contracting through The Superhuman Group LLC."
  jsonLd={jsonLd}
>
  <Hero />

  <section class="mx-auto max-w-content px-6 py-16 md:py-20 border-t border-rule">
    <p class="text-[1.0625rem] leading-relaxed max-w-measure">
      Seven-plus years building production systems in Python, with side trips through Ruby on Rails, TypeScript, and the messy real world of healthcare credentialing, insurance documents, and POS data ingestion. I'm currently taking on contract work through The Superhuman Group LLC — backend systems, data pipelines, and the kind of cross-team product work where someone has to chase a problem through three layers of stack.
    </p>
  </section>

  <WhatIDo />

  <section class="mx-auto max-w-content px-6 py-16 md:py-20 border-t border-rule">
    <h2 class="heading mb-10">Recent work</h2>
    <div class="space-y-12">
      <ProjectCard
        name="Superhuman Finance"
        url="https://finance.thesuperhuman.us"
        description="A personal finance app with Plaid integration — automated transaction ingestion, classification, and reporting across accounts."
        stack={['Rails 8.1', 'Hotwire', 'Tailwind', 'PostgreSQL', 'Plaid']}
      />
      <ProjectCard
        name="Kaillera Next"
        url="https://kaillera-next.thesuperhuman.us"
        description="Play N64 games online with friends in your browser — no install. WebRTC netplay powered by EmulatorJS."
        stack={['Next.js', 'WebRTC', 'EmulatorJS', 'TypeScript']}
      />
    </div>
  </section>

  <section class="mx-auto max-w-content px-6 py-16 md:py-20 border-t border-rule">
    <h2 class="heading mb-10">Selected experience</h2>
    <div>
      <ExperienceRow
        company="Scotch"
        role="Data Engineer"
        dates="2025–2026 · Remote"
        outcome="Sole data engineer at an early-stage startup. Built and maintained ETL pipelines ingesting liquor-store POS transaction data into the company's Rails platform; ran scenario interviews for senior engineering candidates; modeled AI-assisted development practices until the team adopted them."
      />
      <ExperienceRow
        company="Vendorpass / Axuall"
        role="Senior Python Developer (Contract)"
        dates="2025 · Remote"
        outcome="Per-state Dagster ETL pipelines for a healthcare credentialing platform, ingesting from SFTP feeds, REST APIs, and Selenium-driven web scraping. Contributed to the early stages of a connector-architecture migration."
      />
      <ExperienceRow
        company="Sure"
        role="Software Engineer"
        dates="2023–2025 · Remote"
        outcome="Backend on the Toggle homeowners insurance product. Owned document templating — adapting contractor HTML/CSS to carrier-required PDFs — and maintained Django-based document generation and carrier API integrations."
      />
      <ExperienceRow
        company="Lyft"
        role="Software Engineer"
        dates="2021–2023 · Remote"
        outcome="Associate Tools team. Led a third-party rebooking API integration end-to-end, refactored a customer-incident bonus tool from 5k-row to 100k+ row capacity with Grafana self-serve, and owned a 40k-row data migration during a third-party service deprecation."
      />
      <ExperienceRow
        company="Skupos"
        role="Associate Software Engineer / Data Operations Analyst"
        dates="2018–2021 · San Francisco"
        outcome="Designed and built a Python WSGI service that automated POS data quality troubleshooting — replacing ad-hoc analyst work with code that scaled retailer onboarding from 3k to 7–10k locations."
      />
    </div>

    <p class="mt-10 eyebrow">
      <a href="/about#resumes" style="border-bottom: 1px solid var(--accent); padding-bottom: 1px; letter-spacing: 0.12em; color: var(--ink);">
        Looking for the resume? Pick the one that matches your role →
      </a>
    </p>
  </section>

  <section id="contact" class="mx-auto max-w-content px-6 py-16 md:py-20 border-t border-rule">
    <h2 class="heading mb-3">Work with me</h2>
    <p class="text-base text-muted mb-10 max-w-measure">
      Tell me about your project. I usually reply within two business days.
    </p>
    <p class="text-sm text-muted max-w-measure">Contact form coming in Task 19.</p>
  </section>

  <Footer slot="footer" />
</BaseLayout>
```

- [ ] **Step 2: Verify the full landing renders**

Run: `npm run dev`
Open: `http://localhost:4321/`
Expected: scroll through Hero → Intro → What I do → Recent work → Selected experience → "Work with me" placeholder → Footer. Test "Read more →" goes to `/about`. Test the project "Visit live →" links open in new tabs.

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.astro
git commit -m "Assemble landing page with all sections except the form"
```

---

## Task 12: Set up Vitest and add input validation library (TDD begins)

**Files:**
- Create: `vitest.config.ts`, `src/lib/validation.ts`, `tests/lib/validation.test.ts`

- [ ] **Step 1: Create vitest.config.ts**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: { reporter: ['text', 'html'] },
  },
});
```

- [ ] **Step 2: Write failing validation tests**

Create `tests/lib/validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateContactInput } from '~/lib/validation';

describe('validateContactInput', () => {
  const validInput = {
    name: 'Jane',
    email: 'jane@example.com',
    company: '',
    projectType: ['Backend systems'],
    timeline: 'Now',
    budget: '',
    description: 'A long enough description that explains the project clearly.',
    turnstileToken: 'tok',
  };

  it('accepts valid input', () => {
    const result = validateContactInput(validInput);
    expect(result.ok).toBe(true);
  });

  it('rejects missing name', () => {
    const result = validateContactInput({ ...validInput, name: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBeDefined();
  });

  it('rejects invalid email', () => {
    const result = validateContactInput({ ...validInput, email: 'not-an-email' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.email).toBeDefined();
  });

  it('rejects description shorter than 40 chars', () => {
    const result = validateContactInput({ ...validInput, description: 'too short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.description).toBeDefined();
  });

  it('rejects description longer than 4000 chars', () => {
    const result = validateContactInput({ ...validInput, description: 'a'.repeat(4001) });
    expect(result.ok).toBe(false);
  });

  it('rejects empty projectType array', () => {
    const result = validateContactInput({ ...validInput, projectType: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.projectType).toBeDefined();
  });

  it('rejects unknown projectType value', () => {
    const result = validateContactInput({ ...validInput, projectType: ['Cryptocurrency'] });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown timeline value', () => {
    const result = validateContactInput({ ...validInput, timeline: 'Soon' });
    expect(result.ok).toBe(false);
  });

  it('rejects missing turnstile token', () => {
    const result = validateContactInput({ ...validInput, turnstileToken: '' });
    expect(result.ok).toBe(false);
  });

  it('accepts optional fields when empty', () => {
    const result = validateContactInput({ ...validInput, company: '', budget: '' });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests; expect FAIL**

Run: `npm test`
Expected: All tests fail with "Cannot find module" because `validation.ts` doesn't exist.

- [ ] **Step 4: Implement validation.ts**

Create `src/lib/validation.ts`:

```ts
export const PROJECT_TYPES = [
  'Backend systems',
  'Data pipelines',
  'Contract role',
  'Advisory',
  'Other',
] as const;

export const TIMELINES = ['Now', '1–3 months', 'Just exploring'] as const;

export const BUDGETS = ['Under $10k', '$10–50k', '$50k+', 'Not sure yet'] as const;

export type ContactInput = {
  name: string;
  email: string;
  company: string;
  projectType: string[];
  timeline: string;
  budget: string;
  description: string;
  turnstileToken: string;
};

export type ValidationResult =
  | { ok: true; value: ContactInput }
  | { ok: false; errors: Record<string, string> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContactInput(input: unknown): ValidationResult {
  const errors: Record<string, string> = {};

  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: { _form: 'Invalid request body.' } };
  }
  const v = input as Record<string, unknown>;

  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!name) errors.name = 'Name is required.';
  else if (name.length > 100) errors.name = 'Name is too long.';

  const email = typeof v.email === 'string' ? v.email.trim() : '';
  if (!email) errors.email = 'Email is required.';
  else if (email.length > 120 || !EMAIL_RE.test(email)) errors.email = 'Invalid email.';

  const company = typeof v.company === 'string' ? v.company.trim() : '';
  if (company.length > 120) errors.company = 'Company is too long.';

  const projectType = Array.isArray(v.projectType)
    ? v.projectType.filter((t): t is string => typeof t === 'string')
    : [];
  if (projectType.length === 0) {
    errors.projectType = 'Pick at least one project type.';
  } else if (!projectType.every(t => (PROJECT_TYPES as readonly string[]).includes(t))) {
    errors.projectType = 'Unknown project type.';
  }

  const timeline = typeof v.timeline === 'string' ? v.timeline : '';
  if (!(TIMELINES as readonly string[]).includes(timeline)) {
    errors.timeline = 'Pick a timeline.';
  }

  const budget = typeof v.budget === 'string' ? v.budget : '';
  if (budget && !(BUDGETS as readonly string[]).includes(budget)) {
    errors.budget = 'Unknown budget.';
  }

  const description = typeof v.description === 'string' ? v.description.trim() : '';
  if (description.length < 40) {
    errors.description = 'Please write at least 40 characters.';
  } else if (description.length > 4000) {
    errors.description = 'Description is too long.';
  }

  const turnstileToken = typeof v.turnstileToken === 'string' ? v.turnstileToken : '';
  if (!turnstileToken) errors.turnstileToken = 'Captcha missing.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: { name, email, company, projectType, timeline, budget, description, turnstileToken },
  };
}
```

- [ ] **Step 5: Run tests; expect PASS**

Run: `npm test`
Expected: All 10 tests pass.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts src/lib/validation.ts tests/lib/validation.test.ts
git commit -m "Add Vitest and contact input validation with TDD"
```

---

## Task 13: Add Turnstile verification wrapper (TDD)

**Files:**
- Create: `src/lib/turnstile.ts`, `tests/lib/turnstile.test.ts`

- [ ] **Step 1: Write failing Turnstile tests**

Create `tests/lib/turnstile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyTurnstile } from '~/lib/turnstile';

describe('verifyTurnstile', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns true when Cloudflare says success', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });
    const result = await verifyTurnstile('tok', 'secret', '1.2.3.4');
    expect(result).toBe(true);
  });

  it('returns false when Cloudflare says failure', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    });
    const result = await verifyTurnstile('tok', 'secret', '1.2.3.4');
    expect(result).toBe(false);
  });

  it('returns false when fetch rejects', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));
    const result = await verifyTurnstile('tok', 'secret', '1.2.3.4');
    expect(result).toBe(false);
  });

  it('returns false when fetch returns non-OK', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    });
    const result = await verifyTurnstile('tok', 'secret', '1.2.3.4');
    expect(result).toBe(false);
  });

  it('sends token, secret, and remoteip in the form body', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    await verifyTurnstile('TOKEN', 'SECRET', '9.9.9.9');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('challenges.cloudflare.com');
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get('response')).toBe('TOKEN');
    expect(body.get('secret')).toBe('SECRET');
    expect(body.get('remoteip')).toBe('9.9.9.9');
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

Run: `npm test -- turnstile`
Expected: tests fail with "Cannot find module".

- [ ] **Step 3: Implement turnstile.ts**

Create `src/lib/turnstile.ts`:

```ts
const ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp: string,
): Promise<boolean> {
  try {
    const body = new URLSearchParams();
    body.set('secret', secret);
    body.set('response', token);
    body.set('remoteip', remoteIp);

    const res = await fetch(ENDPOINT, { method: 'POST', body });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `npm test -- turnstile`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/turnstile.ts tests/lib/turnstile.test.ts
git commit -m "Add Turnstile verification wrapper with TDD"
```

---

## Task 14: Add KV-backed rate limiter (TDD)

**Files:**
- Create: `src/lib/rate-limit.ts`, `tests/lib/rate-limit.test.ts`

- [ ] **Step 1: Write failing rate-limit tests**

Create `tests/lib/rate-limit.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { checkRateLimit } from '~/lib/rate-limit';

function makeKvStub() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string, _opts?: { expirationTtl: number }) => {
      store.set(k, v);
    }),
  };
}

describe('checkRateLimit', () => {
  it('allows the first request from an IP', async () => {
    const kv = makeKvStub();
    const result = await checkRateLimit(kv as any, '1.2.3.4');
    expect(result.allowed).toBe(true);
  });

  it('records the IP after first call', async () => {
    const kv = makeKvStub();
    await checkRateLimit(kv as any, '1.2.3.4');
    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(kv.put.mock.calls[0][0]).toBe('rl:1.2.3.4');
    expect(kv.put.mock.calls[0][2]).toEqual({ expirationTtl: 300 });
  });

  it('denies a second request within the window', async () => {
    const kv = makeKvStub();
    await checkRateLimit(kv as any, '1.2.3.4');
    const result = await checkRateLimit(kv as any, '1.2.3.4');
    expect(result.allowed).toBe(false);
  });

  it('allows requests from a different IP', async () => {
    const kv = makeKvStub();
    await checkRateLimit(kv as any, '1.2.3.4');
    const result = await checkRateLimit(kv as any, '5.6.7.8');
    expect(result.allowed).toBe(true);
  });

  it('uses a 300-second TTL', async () => {
    const kv = makeKvStub();
    await checkRateLimit(kv as any, '1.2.3.4');
    expect(kv.put.mock.calls[0][2]).toEqual({ expirationTtl: 300 });
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

Run: `npm test -- rate-limit`
Expected: tests fail with "Cannot find module".

- [ ] **Step 3: Implement rate-limit.ts**

Create `src/lib/rate-limit.ts`:

```ts
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>;
}

const WINDOW_SECONDS = 300;

export async function checkRateLimit(
  kv: KvLike,
  ip: string,
): Promise<{ allowed: boolean }> {
  const key = `rl:${ip}`;
  const existing = await kv.get(key);
  if (existing) return { allowed: false };
  await kv.put(key, '1', { expirationTtl: WINDOW_SECONDS });
  return { allowed: true };
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `npm test -- rate-limit`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rate-limit.ts tests/lib/rate-limit.test.ts
git commit -m "Add KV-backed rate limiter with 5-minute window"
```

---

## Task 15: Add Resend wrapper (TDD)

**Files:**
- Create: `src/lib/resend.ts`, `tests/lib/resend.test.ts`

- [ ] **Step 1: Write failing Resend wrapper tests**

Create `tests/lib/resend.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendContactEmails } from '~/lib/resend';
import type { ContactInput } from '~/lib/validation';

const input: ContactInput = {
  name: 'Jane',
  email: 'jane@example.com',
  company: 'Acme',
  projectType: ['Backend systems', 'Data pipelines'],
  timeline: 'Now',
  budget: '$10–50k',
  description: 'Need help with our ingestion pipeline; can pay well.',
  turnstileToken: 'tok',
};

describe('sendContactEmails', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends both primary and autoresponder emails', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'em_1' }) });
    const result = await sendContactEmails({
      input,
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'kazon.wilson@thesuperhuman.us',
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('primary email goes to CONTACT_TO_EMAIL with reply-to set to visitor', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'em_1' }) });
    await sendContactEmails({
      input,
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'kazon.wilson@thesuperhuman.us',
    });
    const primaryBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(primaryBody.to).toContain('kazon.wilson@thesuperhuman.us');
    expect(primaryBody.reply_to).toBe('jane@example.com');
    expect(primaryBody.subject).toContain('Jane');
  });

  it('autoresponder goes to the visitor email', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'em_1' }) });
    await sendContactEmails({
      input,
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'kazon.wilson@thesuperhuman.us',
    });
    const autoBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(autoBody.to).toContain('jane@example.com');
    expect(autoBody.subject).toMatch(/thanks/i);
  });

  it('returns ok=false if primary email fails', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'fail' }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'em_2' }) });
    const result = await sendContactEmails({
      input,
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'kazon.wilson@thesuperhuman.us',
    });
    expect(result.ok).toBe(false);
  });

  it('autoresponder failure does NOT fail the request (best-effort)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'em_1' }) });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'fail' }) });
    const result = await sendContactEmails({
      input,
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'kazon.wilson@thesuperhuman.us',
    });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

Run: `npm test -- resend`
Expected: tests fail with "Cannot find module".

- [ ] **Step 3: Implement resend.ts**

Create `src/lib/resend.ts`:

```ts
import type { ContactInput } from './validation';

const ENDPOINT = 'https://api.resend.com/emails';

interface SendArgs {
  input: ContactInput;
  apiKey: string;
  from: string;
  to: string;
}

function primaryBody(input: ContactInput): string {
  return [
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    input.company ? `Company: ${input.company}` : null,
    `Project type: ${input.projectType.join(', ')}`,
    `Timeline: ${input.timeline}`,
    input.budget ? `Budget: ${input.budget}` : null,
    '',
    'Description:',
    input.description,
  ]
    .filter(Boolean)
    .join('\n');
}

function autoresponderBody(): string {
  return [
    'Thanks for reaching out — I got your message and will respond within two business days.',
    '',
    'In the meantime, if you want a deeper look at my background, the resumes on https://thesuperhuman.us/about (general, leadership, and DoD-focused) cover different angles.',
    '',
    '— Kazon',
  ].join('\n');
}

async function sendOne(args: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<boolean> {
  const payload: Record<string, unknown> = {
    from: args.from,
    to: [args.to],
    subject: args.subject,
    text: args.text,
  };
  if (args.replyTo) payload.reply_to = args.replyTo;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

export async function sendContactEmails(args: SendArgs): Promise<{ ok: boolean }> {
  const primaryOk = await sendOne({
    apiKey: args.apiKey,
    from: args.from,
    to: args.to,
    subject: `New inquiry from ${args.input.name} — ${args.input.projectType.join(', ')}`,
    text: primaryBody(args.input),
    replyTo: args.input.email,
  });
  if (!primaryOk) return { ok: false };

  // Best-effort autoresponder — do not fail the request if this errors.
  await sendOne({
    apiKey: args.apiKey,
    from: args.from,
    to: args.input.email,
    subject: 'Thanks for reaching out — Kazon Wilson',
    text: autoresponderBody(),
  }).catch(() => false);

  return { ok: true };
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `npm test -- resend`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/resend.ts tests/lib/resend.test.ts
git commit -m "Add Resend wrapper with autoresponder (best-effort) via TDD"
```

---

## Task 16: Build the /api/contact Pages Function (TDD)

**Files:**
- Create: `src/pages/api/contact.ts`, `tests/api/contact.test.ts`

- [ ] **Step 1: Write failing endpoint tests**

Create `tests/api/contact.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '~/pages/api/contact';

const validBody = {
  name: 'Jane',
  email: 'jane@example.com',
  company: '',
  projectType: ['Backend systems'],
  timeline: 'Now',
  budget: '',
  description: 'A long enough description that explains the project clearly.',
  turnstileToken: 'tok',
};

function makeKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  };
}

function makeContext(body: unknown, ip = '1.2.3.4', origin = 'https://thesuperhuman.us') {
  const kv = makeKv();
  return {
    request: new Request('https://thesuperhuman.us/api/contact', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': ip,
        origin,
      },
      body: JSON.stringify(body),
    }),
    locals: {
      runtime: {
        env: {
          RESEND_API_KEY: 'key',
          TURNSTILE_SECRET_KEY: 'secret',
          CONTACT_TO_EMAIL: 'kazon.wilson@thesuperhuman.us',
          CONTACT_FROM_EMAIL: 'noreply@thesuperhuman.us',
          RATE_LIMIT: kv,
        },
      },
    },
  } as any;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('challenges.cloudflare.com')) {
      return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
    }
    if (url.includes('resend.com')) {
      return { ok: true, json: async () => ({ id: 'em_1' }) } as unknown as Response;
    }
    return { ok: false, json: async () => ({}) } as unknown as Response;
  }));
});

describe('POST /api/contact', () => {
  it('returns 200 ok=true on valid submission', async () => {
    const res = await POST(makeContext(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('returns 400 with errors on invalid input', async () => {
    const res = await POST(makeContext({ ...validBody, email: 'bad' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.errors.email).toBeDefined();
  });

  it('returns 403 on Turnstile failure', async () => {
    (fetch as any).mockImplementation(async (url: string) => {
      if (url.includes('challenges.cloudflare.com')) {
        return { ok: true, json: async () => ({ success: false }) };
      }
      return { ok: true, json: async () => ({ id: 'em' }) };
    });
    const res = await POST(makeContext(validBody));
    expect(res.status).toBe(403);
  });

  it('returns 429 on rate-limit hit', async () => {
    const ctx = makeContext(validBody);
    const first = await POST(ctx);
    expect(first.status).toBe(200);
    // Same KV reused via second call with same ip
    const ctx2 = {
      ...ctx,
      request: new Request('https://thesuperhuman.us/api/contact', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '1.2.3.4',
          origin: 'https://thesuperhuman.us',
        },
        body: JSON.stringify(validBody),
      }),
    };
    ctx2.locals.runtime.env.RATE_LIMIT = ctx.locals.runtime.env.RATE_LIMIT;
    const second = await POST(ctx2);
    expect(second.status).toBe(429);
  });

  it('returns 403 on origin mismatch', async () => {
    const res = await POST(makeContext(validBody, '1.2.3.4', 'https://evil.example.com'));
    expect(res.status).toBe(403);
  });

  it('returns 500 if Resend primary email fails', async () => {
    (fetch as any).mockImplementation(async (url: string) => {
      if (url.includes('challenges.cloudflare.com')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (url.includes('resend.com')) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: false, json: async () => ({}) };
    });
    const res = await POST(makeContext(validBody));
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

Run: `npm test -- contact`
Expected: tests fail with "Cannot find module".

- [ ] **Step 3: Implement /api/contact endpoint**

Create `src/pages/api/contact.ts`:

```ts
import type { APIRoute } from 'astro';
import { validateContactInput } from '~/lib/validation';
import { verifyTurnstile } from '~/lib/turnstile';
import { checkRateLimit } from '~/lib/rate-limit';
import { sendContactEmails } from '~/lib/resend';

export const prerender = false;

const ALLOWED_ORIGINS = [
  'https://thesuperhuman.us',
  'https://www.thesuperhuman.us',
];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Cloudflare Pages preview deployments
  if (/^https:\/\/[a-z0-9-]+\.thesuperhuman-us\.pages\.dev$/.test(origin)) return true;
  return false;
}

export const POST: APIRoute = async (context) => {
  const { request, locals } = context;
  const env = (locals as any).runtime.env as Env;

  // Origin check
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  // Parse JSON
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  // Validate
  const validation = validateContactInput(body);
  if (!validation.ok) {
    return Response.json({ ok: false, errors: validation.errors }, { status: 400 });
  }
  const input = validation.value;

  // Rate limit by IP
  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  const rl = await checkRateLimit(env.RATE_LIMIT, ip);
  if (!rl.allowed) {
    return Response.json(
      { ok: false, error: 'Please wait a few minutes before submitting again.' },
      { status: 429 },
    );
  }

  // Turnstile
  const turnstileOk = await verifyTurnstile(input.turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
  if (!turnstileOk) {
    return Response.json({ ok: false, error: 'Captcha failed.' }, { status: 403 });
  }

  // Send emails
  const send = await sendContactEmails({
    input,
    apiKey: env.RESEND_API_KEY,
    from: env.CONTACT_FROM_EMAIL,
    to: env.CONTACT_TO_EMAIL,
  });
  if (!send.ok) {
    return Response.json(
      { ok: false, error: 'Email delivery failed. Please email kazon.wilson@thesuperhuman.us directly.' },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
};
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `npm test -- contact`
Expected: All 6 tests pass.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests across `validation`, `turnstile`, `rate-limit`, `resend`, `contact` pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/contact.ts tests/api/contact.test.ts
git commit -m "Add /api/contact Pages Function with validation, Turnstile, rate-limit, and Resend"
```

---

## Task 17: Build the ContactForm browser component

**Files:**
- Create: `src/components/ContactForm.astro`
- Modify: `src/pages/index.astro` (swap the placeholder for the real form)

- [ ] **Step 1: Create ContactForm.astro**

Create `src/components/ContactForm.astro`:

```astro
---
const turnstileSiteKey = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? '';
---
<form id="contact-form" class="space-y-6 max-w-content" novalidate>
  <noscript>
    <p class="text-sm" style="color: var(--accent);">
      This form requires JavaScript. Email
      <a href="mailto:kazon.wilson@thesuperhuman.us">kazon.wilson@thesuperhuman.us</a>
      directly.
    </p>
  </noscript>

  <div class="grid gap-5 md:grid-cols-2">
    <div>
      <label class="eyebrow block mb-2" for="cf-name">Name</label>
      <input id="cf-name" name="name" type="text" required maxlength="100" class="w-full border border-rule bg-paper px-3 py-2 text-base rounded-sm focus:outline-none focus:border-accent" />
      <p class="cf-error text-sm mt-1 hidden" data-field="name" style="color: var(--accent);"></p>
    </div>
    <div>
      <label class="eyebrow block mb-2" for="cf-email">Email</label>
      <input id="cf-email" name="email" type="email" required maxlength="120" class="w-full border border-rule bg-paper px-3 py-2 text-base rounded-sm focus:outline-none focus:border-accent" />
      <p class="cf-error text-sm mt-1 hidden" data-field="email" style="color: var(--accent);"></p>
    </div>
  </div>

  <div>
    <label class="eyebrow block mb-2" for="cf-company">Company <span class="text-muted normal-case tracking-normal">(optional)</span></label>
    <input id="cf-company" name="company" type="text" maxlength="120" class="w-full border border-rule bg-paper px-3 py-2 text-base rounded-sm focus:outline-none focus:border-accent" />
  </div>

  <fieldset>
    <legend class="eyebrow mb-3">Project type</legend>
    <div class="flex flex-wrap gap-2">
      {['Backend systems', 'Data pipelines', 'Contract role', 'Advisory', 'Other'].map(t => (
        <label class="cf-chip cursor-pointer">
          <input type="checkbox" name="projectType" value={t} class="sr-only peer" />
          <span class="inline-block border border-rule px-3 py-1.5 text-sm rounded-full peer-checked:bg-ink peer-checked:text-paper peer-checked:border-ink">
            {t}
          </span>
        </label>
      ))}
    </div>
    <p class="cf-error text-sm mt-2 hidden" data-field="projectType" style="color: var(--accent);"></p>
    <p id="cf-resume-hint" class="text-sm text-muted mt-3 hidden"></p>
  </fieldset>

  <fieldset>
    <legend class="eyebrow mb-3">Timeline</legend>
    <div class="flex flex-wrap gap-4 text-sm">
      {['Now', '1–3 months', 'Just exploring'].map(t => (
        <label class="cursor-pointer">
          <input type="radio" name="timeline" value={t} required />
          <span class="ml-1.5">{t}</span>
        </label>
      ))}
    </div>
    <p class="cf-error text-sm mt-2 hidden" data-field="timeline" style="color: var(--accent);"></p>
  </fieldset>

  <fieldset>
    <legend class="eyebrow mb-3">Budget <span class="text-muted normal-case tracking-normal">(optional)</span></legend>
    <div class="flex flex-wrap gap-4 text-sm">
      {['Under $10k', '$10–50k', '$50k+', 'Not sure yet'].map(t => (
        <label class="cursor-pointer">
          <input type="radio" name="budget" value={t} />
          <span class="ml-1.5">{t}</span>
        </label>
      ))}
    </div>
  </fieldset>

  <div>
    <label class="eyebrow block mb-2" for="cf-description">Tell me about the project</label>
    <textarea id="cf-description" name="description" required minlength="40" maxlength="4000" rows="6" class="w-full border border-rule bg-paper px-3 py-2 text-base rounded-sm focus:outline-none focus:border-accent"></textarea>
    <p class="cf-error text-sm mt-1 hidden" data-field="description" style="color: var(--accent);"></p>
  </div>

  <div class="cf-turnstile" data-sitekey={turnstileSiteKey}></div>

  <div>
    <button type="submit" class="btn-primary" style="border-bottom: none;">Send</button>
    <span id="cf-status" class="ml-4 text-sm text-muted"></span>
  </div>
</form>

<div id="contact-success" class="hidden max-w-content">
  <p class="lede">Got it. I'll reply within two business days.</p>
</div>

<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" defer></script>

<script>
  const form = document.getElementById('contact-form') as HTMLFormElement;
  const success = document.getElementById('contact-success') as HTMLDivElement;
  const status = document.getElementById('cf-status') as HTMLSpanElement;
  const resumeHint = document.getElementById('cf-resume-hint') as HTMLParagraphElement;

  function showHint(types: string[]) {
    if (types.includes('Contract role')) {
      resumeHint.innerHTML = 'Looking for the full resume? <a href="/about#resumes">General</a> or <a href="/about#resumes">Leadership</a>.';
      resumeHint.classList.remove('hidden');
    } else if (types.includes('Advisory')) {
      resumeHint.innerHTML = 'Looking for the full resume? <a href="/about#resumes">Leadership</a>.';
      resumeHint.classList.remove('hidden');
    } else {
      resumeHint.classList.add('hidden');
    }
  }

  form.querySelectorAll('input[name="projectType"]').forEach(el => {
    el.addEventListener('change', () => {
      const selected = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="projectType"]:checked')).map(i => i.value);
      showHint(selected);
    });
  });

  function clearErrors() {
    form.querySelectorAll('.cf-error').forEach(el => {
      el.classList.add('hidden');
      el.textContent = '';
    });
  }

  function showError(field: string, msg: string) {
    const el = form.querySelector<HTMLElement>(`.cf-error[data-field="${field}"]`);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    status.textContent = 'Sending…';

    const data = new FormData(form);
    const projectType = data.getAll('projectType').map(String);
    const turnstileToken = (form.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')?.value) ?? '';

    const payload = {
      name: String(data.get('name') ?? ''),
      email: String(data.get('email') ?? ''),
      company: String(data.get('company') ?? ''),
      projectType,
      timeline: String(data.get('timeline') ?? ''),
      budget: String(data.get('budget') ?? ''),
      description: String(data.get('description') ?? ''),
      turnstileToken,
    };

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        form.classList.add('hidden');
        success.classList.remove('hidden');
        return;
      }
      status.textContent = '';
      if (json.errors) {
        for (const [k, v] of Object.entries(json.errors as Record<string, string>)) {
          showError(k, v);
        }
      } else if (json.error) {
        status.textContent = json.error;
      }
    } catch {
      status.textContent = 'Network error — please try again.';
    }
  });
</script>
```

- [ ] **Step 2: Wire the form into the landing page**

In `src/pages/index.astro`, add the import:

```astro
import ContactForm from '~/components/ContactForm.astro';
```

Replace the placeholder `<p class="text-sm text-muted max-w-measure">Contact form coming in Task 19.</p>` with:

```astro
<ContactForm />
```

- [ ] **Step 3: Add the PUBLIC_TURNSTILE_SITE_KEY env declaration**

In `src/env.d.ts`, add to the bottom:

```ts
interface ImportMetaEnv {
  readonly PUBLIC_TURNSTILE_SITE_KEY: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 4: Create .dev.vars for local Turnstile (test keys)**

Create `.dev.vars` (NOT committed; in `.gitignore`):

```
PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
RESEND_API_KEY=re_test_local_only
CONTACT_TO_EMAIL=kazon.wilson@thesuperhuman.us
CONTACT_FROM_EMAIL=noreply@thesuperhuman.us
```

(Turnstile test keys always pass; Resend test key won't actually send but the endpoint will return non-OK — fine for local form UX testing.)

- [ ] **Step 5: Verify form renders**

Run: `npm run dev`
Open: `http://localhost:4321/#contact`
Expected: Form renders with all fields. Selecting "Contract role" reveals the resume hint. Submitting with errors shows inline messages. Submitting with valid data either succeeds (200 if all env wiring works locally) or shows the 500 error (Resend not configured locally) — either way the form's wiring is working.

- [ ] **Step 6: Commit**

```bash
git add src/components/ContactForm.astro src/pages/index.astro src/env.d.ts
git commit -m "Add ContactForm with Turnstile, validation, and inline resume hints"
```

---

## Task 18: Add favicon, OG image, and robots.txt

**Files:**
- Create: `public/favicon.svg`, `public/og-image.png`, `public/robots.txt`

- [ ] **Step 1: Create favicon.svg**

Create `public/favicon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#FBF8F2"/>
  <text x="32" y="44" font-family="Newsreader, Georgia, serif" font-size="42" text-anchor="middle" fill="#0E0E0E">K</text>
  <circle cx="50" cy="14" r="4" fill="#B85C38"/>
</svg>
```

- [ ] **Step 2: Create a placeholder og-image.png**

Run:

```bash
curl -s -o public/og-image.png 'https://placehold.co/1200x630/FBF8F2/0E0E0E.png?text=Kazon+Wilson'
ls -lh public/og-image.png
```

Expected: 1200×630 PNG saved. (We'll replace this with a hand-designed version in the polish task if desired.)

- [ ] **Step 3: Create robots.txt**

Create `public/robots.txt`:

```
User-agent: *
Allow: /

Sitemap: https://thesuperhuman.us/sitemap-index.xml
```

- [ ] **Step 4: Verify the build produces all three**

Run: `npm run build && ls dist/`
Expected: `favicon.svg`, `og-image.png`, `robots.txt`, `sitemap-index.xml` all in `dist/`.

- [ ] **Step 5: Commit**

```bash
git add public/favicon.svg public/og-image.png public/robots.txt
git commit -m "Add favicon, OG image, and robots.txt"
```

---

## Task 19: Accessibility pass

**Files:**
- Modify: any component needing a fix.

- [ ] **Step 1: Run Lighthouse on the landing page locally**

Run:

```bash
npm run build
npm run preview &
sleep 2
npx lighthouse http://localhost:4321 --only-categories=accessibility --quiet --chrome-flags="--headless" --output=json --output-path=/tmp/lh-landing.json
kill %1 2>/dev/null
node -e "const r = JSON.parse(require('fs').readFileSync('/tmp/lh-landing.json')); console.log('a11y score:', r.categories.accessibility.score * 100); const issues = r.audits; for (const k of Object.keys(issues)) { const a = issues[k]; if (a.score !== null && a.score < 1) console.log('-', a.title); }"
```

Expected: score reported; any failing audits listed.

- [ ] **Step 2: Fix any issues surfaced**

Common fixes the audit may surface:
- Missing form labels — already addressed but double-check.
- Insufficient color contrast — verify rust on paper (4.5:1+) at body sizes.
- Missing `alt` on images — `<img>` tags in components must have `alt`.
- Skip link visibility on focus — verified in `global.css`.

Apply fixes directly to the relevant component or `global.css`.

- [ ] **Step 3: Run Lighthouse on /about**

Run:

```bash
npm run preview &
sleep 2
npx lighthouse http://localhost:4321/about --only-categories=accessibility --quiet --chrome-flags="--headless" --output=json --output-path=/tmp/lh-about.json
kill %1 2>/dev/null
node -e "const r = JSON.parse(require('fs').readFileSync('/tmp/lh-about.json')); console.log('a11y score:', r.categories.accessibility.score * 100);"
```

Expected: score ≥ 95.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "Accessibility pass: address Lighthouse audit findings"
```

(If no fixes were needed, skip the commit and move on.)

---

## Task 20: Performance pass

**Files:**
- Modify: as needed.

- [ ] **Step 1: Run Lighthouse perf audit**

Run:

```bash
npm run build
npm run preview &
sleep 2
npx lighthouse http://localhost:4321 --only-categories=performance --quiet --chrome-flags="--headless" --output=json --output-path=/tmp/lh-perf.json
kill %1 2>/dev/null
node -e "const r = JSON.parse(require('fs').readFileSync('/tmp/lh-perf.json')); console.log('perf score:', r.categories.performance.score * 100); console.log('LCP:', r.audits['largest-contentful-paint'].displayValue);"
```

Expected: perf ≥ 95.

- [ ] **Step 2: If headshot is the LCP and slow, switch to Astro's Image component**

If LCP > 2.0s and audit calls out the headshot, modify `src/components/Hero.astro`:

Replace the `<img>` tag with:

```astro
---
import { Image } from 'astro:assets';
import headshot from '~/../public/headshot.jpg';
---
```

…then replace the existing `<img>` element with:

```astro
<Image
  src={headshot}
  alt="Kazon Wilson"
  width={560}
  height={700}
  format="avif"
  quality={80}
  loading="eager"
  class="w-full max-w-[280px] aspect-[4/5] object-cover object-[center_25%] rounded-sm"
/>
```

- [ ] **Step 3: Re-run perf audit**

Run the same Lighthouse command from Step 1.
Expected: perf ≥ 95.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "Performance pass: image pipeline and LCP optimization"
```

---

## Task 21: Add README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

Create `README.md` with the following content (note: the outer code fence below uses four backticks so the inner triple-backtick block renders correctly inside the file):

````markdown
# thesuperhuman.us

Personal site for Kazon Wilson · backend & data engineer · contracting through The Superhuman Group LLC.

## Stack

- Astro 5 (static output, `@astrojs/cloudflare` adapter)
- TypeScript
- Tailwind CSS
- Resend (transactional email)
- Cloudflare Turnstile (spam protection)
- Cloudflare KV (rate limiting)
- Vitest (unit tests)

## Development

```bash
npm install
npm run dev       # local Astro dev server on http://localhost:4321
npm test          # run Vitest unit tests
npm run check     # Astro type-check
npm run build     # production build into dist/
npm run preview   # serve the built site locally
```

Local env vars live in `.dev.vars` (not committed). See `src/env.d.ts` for required variables.

## Deployment

Push to `main` → Cloudflare Pages builds and deploys to https://thesuperhuman.us.

Env vars set in the Cloudflare Pages dashboard:

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Resend API key |
| `TURNSTILE_SITE_KEY` (also `PUBLIC_TURNSTILE_SITE_KEY` for the client) | Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Turnstile secret |
| `CONTACT_TO_EMAIL` | `kazon.wilson@thesuperhuman.us` |
| `CONTACT_FROM_EMAIL` | `noreply@thesuperhuman.us` |

KV namespace `RATE_LIMIT` must be bound to the Pages project.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add README with development and deployment notes"
```

---

## Task 22: Push to GitHub and connect Cloudflare Pages (manual, by operator)

**No automated steps — these are operator actions in the Cloudflare and GitHub dashboards.**

- [ ] **Step 1: Create GitHub repo**

Run:

```bash
gh repo create kwilson21/thesuperhuman.us --private --source=. --remote=origin --push
```

Expected: Repo created on GitHub and `main` pushed.

- [ ] **Step 2: Create Cloudflare Pages project**

In the Cloudflare dashboard:
- Pages → Create application → Connect to Git → select `kwilson21/thesuperhuman.us` → branch `main`.
- Build command: `npm run build`
- Build output: `dist`
- Framework preset: Astro
- Save and deploy.

Verify the preview URL (`<project>.pages.dev`) shows the site.

- [ ] **Step 3: Create the KV namespace and bind it**

In the Cloudflare dashboard:
- Workers & Pages → KV → Create namespace named `RATE_LIMIT`.
- Pages project → Settings → Functions → KV namespace bindings → bind variable `RATE_LIMIT` to the namespace.

- [ ] **Step 4: Create Turnstile site**

In the Cloudflare dashboard:
- Turnstile → Add site → domain `thesuperhuman.us` → widget mode "Invisible".
- Copy the site key and secret.

- [ ] **Step 5: Set up Resend**

In the Resend dashboard:
- Add domain `thesuperhuman.us`.
- Add the DKIM + SPF + return-path DNS records they show into Cloudflare DNS.
- Wait for verification (usually <5 min).
- Create an API key with sending permissions.

- [ ] **Step 6: Provision the mailbox**

Ensure `kazon.wilson@thesuperhuman.us` exists and is receiving mail. Without it, the form submits successfully but no inquiry is delivered.

- [ ] **Step 7: Add env vars to Cloudflare Pages**

Pages project → Settings → Environment variables, add (for both Production and Preview):

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | from Resend |
| `TURNSTILE_SITE_KEY` | from Turnstile |
| `PUBLIC_TURNSTILE_SITE_KEY` | same as above (browser-readable) |
| `TURNSTILE_SECRET_KEY` | from Turnstile (encrypted) |
| `CONTACT_TO_EMAIL` | `kazon.wilson@thesuperhuman.us` |
| `CONTACT_FROM_EMAIL` | `noreply@thesuperhuman.us` |

Trigger a re-deploy after saving.

- [ ] **Step 8: Point DNS**

In Cloudflare DNS:
- Apex `thesuperhuman.us` → CNAME (flattened) → `<project>.pages.dev`.
- `www.thesuperhuman.us` → Page Rule or Bulk Redirect → 301 to `https://thesuperhuman.us/$1`.

(Existing `finance.` and `kaillera-next.` records remain untouched.)

- [ ] **Step 9: Smoke test the live form**

Visit `https://thesuperhuman.us/#contact`. Submit a real test inquiry. Verify:
- Primary email arrives at `kazon.wilson@thesuperhuman.us`.
- Autoresponder arrives at the submitting email.
- A second submission within 5 minutes from the same IP returns the rate-limit message.

---

## Self-review notes

After writing this plan, I checked against the spec:

- **Section 2 (Architecture & deployment):** Tasks 1, 22 cover Astro + Cloudflare adapter, env vars, DNS, Resend setup.
- **Section 3 (Visual system):** Tasks 2, 3 cover tokens, fonts, type scale, drop cap.
- **Section 4 (Information architecture):** Tasks 5, 11 cover the two pages plus `/api/contact`.
- **Section 5 (Landing sections):** Tasks 8 (Hero), 9 (WhatIDo, Project, Experience), 10 (Footer), 11 (assembly with all sections in order).
- **Section 6 (About sections):** Tasks 4 (collection), 5 (page render with editorial type), 6 (resume chooser).
- **Section 7 (Contact form):** Tasks 12–16 (TDD'd backend), 17 (browser component with all fields, hints, no-script fallback, origin check via the endpoint).
- **Section 8 (Repo structure):** All files in the file map; structure built through tasks 1–17.
- **Section 9 (Implementation order):** Plan order matches.
- **Section 10 (NFRs):** Tasks 19 (a11y), 20 (perf), Task 5 + 11 (SEO via JSON-LD + sitemap auto-generation).
- **Section 11 (Future-friendly):** `src/content/notes/` directory scaffolded in Task 4; CSS tokens in Task 2 enable future dark mode.
- **Section 12 (Deployment prerequisites):** Task 22 enumerates all of them.
- **Section 13 (Open items resolved during implementation):** Copy drafts for intro, experience one-liners, and "What I do" body sentences all materialized as concrete prose in Tasks 9 and 11.
