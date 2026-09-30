import { lyftBonus } from '~/data/profile';
import tallyImage from '~/assets/site/tally-transactions.webp';
import { tallyStory } from '~/data/project-stories/tally';
import { softwarePaths } from '~/lib/software-inquiry';

export const softwareSheet = {
  path: '/services',
  title: 'Let’s build something useful.',
  introduction: 'Make a workflow easier, or bring an idea to life. We’ll choose a clear first milestone together.',
  approach: 'We agree on the work and a fixed price before I start. We share questions and feedback in writing, and I use AI to help build the software.',
  workflow: { title: softwarePaths.workflow, lead: 'For the tasks your team keeps doing by hand.', detail: 'I build a tool or connect the systems you already use so your team can do a repeated task with fewer manual steps.', button: 'Tell me about your workflow', path: '/software/start?path=workflow',
    evidenceLabel: 'Relevant work',
    evidence: { title: 'Skupos · Internal tools', description: 'I built a tool that helped data operators troubleshoot retail transactions and automated updates to their shared Google Sheets.', path: '/work#skupos', context: 'about Skupos' },
    historyLabel: 'Explore my work history', historyPath: '/work',
  },
  idea: { title: softwarePaths.idea, lead: 'For an idea you want people to try.', detail: 'I build a first version that lets people try the most important part of your idea.', button: 'Tell me about your idea', path: '/software/start?path=idea', project: tallyStory,
    image: tallyImage, imageAlt: 'Tally’s transactions screen, running on demo data', imageCaption: 'Tally · public demo on demo data',
    evidenceLabel: 'Try something I’m building', meta: 'Personal project · Public demo · In development',
    demoUrl: 'https://tally-demo.thesuperhuman.us', demoLabel: 'Try the demo',
    projectPath: '/building/tally', projectLabel: 'Explore the project',
  },
  hero: { title: 'Lyft · Associate Tools', description: lyftBonus.description, path: '/work#lyft', context: 'about Lyft', figure: lyftBonus },
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
    { title: 'Share the situation', description: 'Tell me what happens today or what you want people to try.' },
    { title: 'Review the first milestone', description: 'I’ll review your brief and propose a scope, deliverables and fixed price.' },
    { title: 'Agree, then begin', description: 'We agree on the terms before I begin.' },
  ],
};

export type ServiceSheet = typeof softwareSheet;
