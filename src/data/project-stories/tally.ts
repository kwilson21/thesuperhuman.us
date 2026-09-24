import type { ImageMetadata } from 'astro';
import type { Milestone } from '~/lib/project-story';
import designSystem from '~/assets/projects/tally/design-system-annotated.webp';
import home from '~/assets/projects/tally/home-annotated.webp';

export const tallyStory = {
  title: 'Tally',
  subtitle: 'A budgeting app so simple that using it teaches you how to budget.',
  description: 'Inspired by Mint. I set the direction and Claude Code writes the code.',
};

const artifact = (image: ImageMetadata, title: string, caption: string, kind: string) => ({
  src: image.src, width: image.width, height: image.height, title, caption, kind,
  alt: `${title}. ${caption}`,
});

// Publicist backfill. Each entry is the owner-approved draft from its private
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
];
