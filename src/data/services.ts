import { tallyStory } from '~/data/project-stories/tally';
import { softwarePaths } from '~/lib/software-inquiry';

export interface ServiceSheet {
  path: string;
  title: string;
  introduction: string;
  approach: string;
  workflow: { title: string; lead: string; detail: string; button: string; path: string };
  idea: { title: string; lead: string; detail: string; button: string; path: string; project: Pick<typeof tallyStory, 'title' | 'subtitle'> };
  evidence: { title: string; description: string; path: string; context: string }[];
  labels: string[];
  caption: string;
  evidenceLabel: string;
  ideaEvidenceLabel: string;
  meta: string;
  demoUrl: string;
  demoLabel: string;
  projectPath: string;
  projectLabel: string;
  imageAlt: string;
  storyLabel: string;
  historyLabel: string;
  historyPath: string;
  kicker: string;
  differenceHeading: string;
  figureCaption: string;
  fitHeading: string;
  fitCaption: string;
  quote: string;
  imageCaption: string;
  beforeIntro: string;
  agreement: string;
  startLabel: string;
  startPath: string;
  audioLead: string;
  audioLabel: string;
  audioPath: string;
  stepsHeading: string;
  steps: { title: string; description: string }[];
}

export const softwareSheet: ServiceSheet = {
  path: '/services',
  title: 'Let’s build something useful.',
  introduction: 'Make a workflow easier, or bring an idea to life. We’ll choose a clear first milestone together.',
  approach: 'Fixed-price projects · Written, async collaboration · AI-assisted building',
  workflow: { title: softwarePaths.workflow, lead: 'For the tasks your team keeps doing by hand.', detail: 'A focused tool, automation, or integration.', button: 'Tell me about your workflow', path: '/software/start?path=workflow' },
  idea: { title: softwarePaths.idea, lead: 'For an idea you want people to try.', detail: 'One core experience, built to explore.', button: 'Tell me about your idea', path: '/software/start?path=idea', project: tallyStory },
  evidence: [
    { title: 'Lyft · Associate Tools', description: 'Refactored a bonus tool and added visibility so support could run and monitor the work.', path: '/work#lyft', context: 'about Lyft' },
    { title: 'Skupos · Internal tools', description: 'Built and owned a Flask application that automated retail transaction-data troubleshooting.', path: '/work#skupos', context: 'about Skupos' },
  ],
  labels: ['Manual steps', 'Shared tool', 'Team runs the work'],
  caption: 'Illustrated workflow',
  evidenceLabel: 'Relevant work',
  ideaEvidenceLabel: 'Try something I’m building',
  meta: 'Personal project · Public demo · In development',
  demoUrl: 'https://tally-demo.thesuperhuman.us',
  demoLabel: 'Try the demo',
  projectPath: '/building/tally',
  projectLabel: 'Explore the project',
  imageAlt: 'Tally’s transactions screen, running on demo data',
  storyLabel: 'Read the work story',
  historyLabel: 'Explore my work history',
  historyPath: '/work',
  kicker: 'Software',
  differenceHeading: 'See the difference.',
  figureCaption: 'rows per batch · owner-reported',
  fitHeading: 'Find the right fit.',
  fitCaption: 'Fixed price · agreed in writing before work begins',
  quote: 'Quoted after your brief',
  imageCaption: 'Tally · public demo on demo data',
  beforeIntro: 'Communication is async. Every project starts with a short written brief. I reply by email with a question, a proposed first milestone with a fixed price, or a note if it isn’t a fit.',
  agreement: 'Nothing starts until we agree on the scope and price.',
  startLabel: 'Start a project brief',
  startPath: '/software/start',
  audioLead: 'Looking for mixing or mastering?',
  audioLabel: 'Audio services',
  audioPath: '/services',
  stepsHeading: 'Before we start.',
  steps: [
    { title: 'Share the situation', description: 'A short brief, in your own words.' },
    { title: 'Review the first milestone', description: 'Scope, deliverables and a fixed price.' },
    { title: 'Agree, then begin', description: 'Work starts after the terms are agreed.' },
  ],
};
