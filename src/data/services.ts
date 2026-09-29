import { lyftBonus } from '~/data/profile';
import tallyImage from '~/assets/site/tally-transactions.webp';
import { tallyStory } from '~/data/project-stories/tally';
import { softwarePaths } from '~/lib/software-inquiry';

export const softwareSheet = {
  path: '/services',
  title: 'Let’s build something useful.',
  introduction: 'Make a workflow easier, or bring an idea to life. We’ll choose a clear first milestone together.',
  approach: 'Fixed-price projects · Written, async collaboration · AI-assisted building',
  workflow: { title: softwarePaths.workflow, lead: 'For the tasks your team keeps doing by hand.', detail: 'A focused tool, automation, or integration.', button: 'Tell me about your workflow', path: '/software/start?path=workflow',
    evidenceLabel: 'Relevant work',
    evidence: { title: 'Skupos · Internal tools', description: 'Built and owned a Flask application that automated retail transaction-data troubleshooting.', path: '/work#skupos', context: 'about Skupos' },
    historyLabel: 'Explore my work history', historyPath: '/work',
  },
  idea: { title: softwarePaths.idea, lead: 'For an idea you want people to try.', detail: 'One core experience, built to explore.', button: 'Tell me about your idea', path: '/software/start?path=idea', project: tallyStory,
    image: tallyImage, imageAlt: 'Tally’s transactions screen, running on demo data', imageCaption: 'Tally · public demo on demo data',
    evidenceLabel: 'Try something I’m building', meta: 'Personal project · Public demo · In development',
    demoUrl: 'https://tally-demo.thesuperhuman.us', demoLabel: 'Try the demo',
    projectPath: '/building/tally', projectLabel: 'Explore the project',
  },
  hero: { title: 'Lyft · Associate Tools', description: 'Refactored a bonus tool and added visibility so support could run and monitor the work.', path: '/work#lyft', context: 'about Lyft', figure: lyftBonus },
  storyLabel: 'Read the work story',
  kicker: 'Software',
  differenceHeading: 'See the difference.',
  figureCaption: 'rows per batch · owner-reported',
  fitHeading: 'Find the right fit.',
  audioLead: 'Looking for mixing or mastering?',
  audioLabel: 'Audio services',
  audioServicesPath: '/services',
  stepsHeading: 'Before we start.',
  steps: [
    { title: 'Share the situation', description: 'A short brief, in your own words.' },
    { title: 'Review the first milestone', description: 'Scope, deliverables and a fixed price.' },
    { title: 'Agree, then begin', description: 'Work starts after the terms are agreed.' },
  ],
};

export type ServiceSheet = typeof softwareSheet;
