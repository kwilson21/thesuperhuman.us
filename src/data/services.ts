import type { ImageMetadata } from 'astro';
import { lyftBonus } from '~/data/profile';
import tallyImage from '~/assets/site/tally-transactions.webp';
import { kailleraStory } from '~/data/project-stories/kaillera-next';
import { tallyStory } from '~/data/project-stories/tally';
import { doors } from '~/data/work-with-me';
import { softwarePaths } from '~/lib/software-inquiry';

const websiteDoor = doors.find(door => door.id === 'website')!;

export type ServiceLink = { label: string; path: string; context?: string } | { label: string; url: string };

export interface ServiceEvidence {
  title: string;
  description?: string;
  meta?: string;
  links: ServiceLink[];
}

export interface ServiceRow {
  id: string;
  title: string;
  lead: string;
  detail: string;
  button: string;
  path: string;
  image?: ImageMetadata;
  imageAlt?: string;
  imageCaption?: string;
  diagram?: 'analyst';
  evidenceLabel: string;
  evidence: ServiceEvidence[];
  historyLabel?: string;
  historyPath?: string;
}

// Each row opens its own intake (see softwarePaths); its evidence links to the work behind that path.
const rows: ServiceRow[] = [
  {
    id: 'website', title: softwarePaths.website, lead: 'For a site people can read on a phone and act on.', detail: websiteDoor.line, button: 'Tell me about your website', path: '/software/start?path=website',
    image: websiteDoor.picture, imageAlt: 'This site’s Home page, with the introduction and the Start a project button', imageCaption: websiteDoor.caption,
    evidenceLabel: 'Relevant work',
    evidence: [{ title: 'This site', meta: 'September 2026 redesign', links: [{ label: 'Explore the project', path: '/building/personal-website', context: 'about this site' }] }],
  },
  {
    id: 'web-app', title: softwarePaths.webapp, lead: 'For an app people open in a browser, on a phone or a computer.', detail: 'I build a first version that lets people try the most important part of your idea.', button: 'Tell me about your app', path: '/software/start?path=webapp',
    image: tallyImage, imageAlt: 'Tally’s transactions screen, running on demo data', imageCaption: 'Tally · public demo on demo data',
    evidenceLabel: 'Try something I’m building',
    evidence: [
      { title: tallyStory.title, description: tallyStory.subtitle, meta: 'Personal project · Public demo · In development', links: [{ label: 'Try the demo', url: 'https://tally-demo.thesuperhuman.us' }, { label: 'Explore the project', path: '/building/tally', context: 'about Tally' }] },
      { title: kailleraStory.title, description: kailleraStory.subtitle, meta: kailleraStory.status, links: [{ label: 'Play the demo', url: 'https://kaillera-next.thesuperhuman.us' }, { label: 'Explore the project', path: '/building/kaillera-next', context: 'about Kaillera Next' }] },
    ],
  },
  {
    id: 'workflow', title: softwarePaths.workflow, lead: 'For the tasks your team keeps doing by hand.', detail: 'I build a tool or connect the systems you already use so your team can do a repeated task with fewer manual steps.', button: 'Tell me about your workflow', path: '/software/start?path=workflow',
    diagram: 'analyst',
    evidenceLabel: 'Relevant work',
    evidence: [{ title: 'Skupos · Internal tools', description: 'I built a tool that helped data operators troubleshoot retail transactions and automated updates to their shared Google Sheets.', links: [{ label: 'Read the work story', path: '/work#skupos', context: 'about Skupos' }] }],
    historyLabel: 'Explore my work history', historyPath: '/work',
  },
];

export const softwareSheet = {
  path: '/services',
  title: 'Let’s build something useful.',
  kicker: 'Websites & software',
  introduction: 'A website, a web app, or a task your team repeats. We’ll choose a clear first milestone together.',
  approach: 'We agree on the work and a fixed price before I start. We share questions and feedback in writing. I make the design decisions and review every change; Claude Code helps with implementation.',
  rows,
  hero: { title: 'Lyft · Associate Tools', description: lyftBonus.description, path: '/work#lyft', context: 'about Lyft', figure: lyftBonus },
  storyLabel: 'Read the work story',
  differenceHeading: 'See the difference.',
  figureCaption: 'rows per batch · owner-reported',
  fitHeading: 'Find the right fit.',
  audioLead: 'Looking for mixing or mastering?',
  audioLabel: 'Audio services',
  audioServicesPath: '/services',
  stepsHeading: 'Before we start.',
  steps: [
    { title: 'Share the situation', description: 'Tell me what you want to build, or what happens today.' },
    { title: 'Review the first milestone', description: 'I’ll review your brief and propose a scope, deliverables and fixed price.' },
    { title: 'Agree, then begin', description: 'We agree on the terms before I begin.' },
  ],
};

export type ServiceSheet = typeof softwareSheet;
