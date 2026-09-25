import type { ImageMetadata } from 'astro';
import type { Milestone } from '~/lib/project-story';
import designSystem from '~/assets/projects/tally/design-system-annotated.webp';
import home from '~/assets/projects/tally/home-annotated.webp';
import transactionsEdit from '~/assets/projects/tally/transactions-edit-annotated.webp';
import demoDiagram from '~/assets/projects/tally/demo-environment-diagram.webp';
import jevDiagram from '~/assets/projects/tally/jev-categorization-diagram.webp';
import phaseOneHome from '~/assets/projects/tally/phase-1-home-annotated.webp';

export const tallyStory = {
  title: 'Tally',
  subtitle: 'A budgeting app so simple that using it teaches you how to budget.',
  description: 'Inspired by Mint. I set the direction and Claude Code writes the code.',
};

const artifact = (image: ImageMetadata, title: string, caption: string, kind: string) => ({
  src: image.src, width: image.width, height: image.height, title, caption, kind,
  alt: `${title}. ${caption}`,
});

// Publicist entries. Each is the owner-approved draft from its private
// review note (same ID), changed only for formatting. Captures use demo data.
export const tallyMilestones: Milestone[] = [
  {
    id: 'tally-phase-0', day: '2026-09-22',
    title: 'Why Tally',
    summary: 'I’m building Tally because nothing replaced Mint for me after it shut down. The goal is a budgeting app so simple that using it teaches you how to budget, and easy enough to come back to on a regular rhythm. It replaces my older Django personal finance app. I set the direction and Claude Code writes the code, under one rule: every part must be explainable in one plain sentence.',
    backfilled: true,
  },
  {
    id: 'tally-design-direction', day: '2026-09-22',
    title: 'Finding the look',
    summary: 'Before writing any UI, I ran four rounds of design studies. The first direction felt sterile on real screens, so I added character: tally marks, serif titles, an icon per category and one line illustration. Status always pairs color with an icon and a word.',
    backfilled: true,
  },
  {
    id: 'tally-design-system', day: '2026-09-22',
    title: 'The building blocks',
    summary: 'Claude Code set up the parts every screen shares, following the look I chose: a color palette, two open-source fonts and Lucide icons served from Tally itself, and the app shell. Its call: serve everything from Tally’s own origin so the security policy can block anything else. The trade-off is no inline styles, so the budget bars are SVG.',
    backfilled: true,
    artifacts: [artifact(designSystem, 'Tally · The building blocks', 'The app shell from PR #37 on demo data, with numbered pointers to each part and the color palette.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-data-and-money', day: '2026-09-22',
    title: 'Decisions that make cents',
    summary: 'Claude Code made the data calls here. Money is stored as whole cents, because SQLite has no exact decimal type, and all budget math lives in small tested functions. Income stays out of spending, so an uncategorized paycheck can’t look like negative spending. The public demo uses a fictional household that resets nightly.',
    backfilled: true,
  },
  {
    id: 'tally-ci-screenshots', day: '2026-09-23',
    title: 'Screenshots on every PR',
    summary: 'Every pull request now gets desktop and phone screenshots of each page, so I can review UI without running the app. They’re captured from demo data and stored in the same repository, with no extra service.',
    backfilled: true,
  },
  {
    id: 'tally-home-screen', day: '2026-09-23',
    title: 'The Home screen',
    summary: 'Home answers the question my family asks most: how much can we still spend this month? Safe to spend leads, and everything below it explains that number. Bills arrive in Phase 3, so for now it doesn’t subtract them.',
    backfilled: true,
    artifacts: [artifact(home, 'Tally · The Home screen', 'The Home screen from PR #41 on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-transactions', day: '2026-09-24',
    title: 'Finding and fixing transactions',
    summary: 'Home tells you how many transactions still need a category. This is where you fix them. The Transactions list has search, month and category filters, and a Needs category filter that always matches Home’s count. Tap a row to pick a category, rename the merchant, add a note, or tick one box to always use that category for the merchant. Saving updates the list and Home together. Claude Code built it, including a browser test that goes from Home’s band through one fix. Built and tested on demo data.',
    artifacts: [artifact(transactionsEdit, 'Tally · Finding and fixing transactions', 'The edit panel over the Needs category list, from PR #45 on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-demo-environment', day: '2026-09-24',
    title: 'A demo that cleans up after itself',
    summary: 'I wanted to try each change on my phone or laptop without running anything locally. So Tally’s demo is the same code deployed a second time, with its own database, a single public address and only fictional data. Every night it resets to that fictional household. The reset erases every table, so at my request it also checks for bank credentials, which the real app always has, and refuses to run if it finds any. Claude Code built the setup and a test that pins those safety settings. Deploying stays a step I run myself.',
    artifacts: [artifact(demoDiagram, 'Tally · A demo that cleans up after itself', 'The demo deployment, its own database, the nightly reset and the two-part guard.', 'Diagram')],
  },
  {
    id: 'tally-jev-categorization', day: '2026-09-24',
    title: 'AI suggests, people decide',
    summary: 'Tally’s rule is that AI suggests, code calculates and people decide. So each night, after merchant rules run, Tally asks Jev, an AI classifier, about up to 40 transactions that still need a category. Code applies an answer only when Jev is at least 80% sure, and never over a choice a person or a rule already made. The edit panel shows "Picked by Jev · 93% sure" so you can change it. After Jev’s first run on the demo, I added a "None of these fit" answer, because Household had turned into a catch-all. Claude Code built it.',
    artifacts: [artifact(jevDiagram, 'Tally · AI suggests, people decide', 'The nightly order: merchant rules first, then Jev, with the 80% rule and a write that never overrides a person.', 'Diagram')],
  },
  {
    id: 'tally-phase-1-done', day: '2026-09-25',
    title: 'Phase 1 done: a demo that explains itself',
    summary: 'Tally’s first phase is done: the demo loads over HTTPS, every Phase 1 screen works, and there are no console errors. The demo now explains itself. Home has a short Things to try list, and How Tally works shows the system diagram, each rule in plain words, and worked examples computed from the demo’s own live numbers. Claude Code then reviewed what was built against the spec, and I approved its proposals: default categories and excluding transfers move into Phase 2, so the numbers are right from day one. Try it at tally-demo.thesuperhuman.us.',
    artifacts: [artifact(phaseOneHome, 'Tally · Phase 1 done', 'The demo Home with Things to try, from PR #52 on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
];
