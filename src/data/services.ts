export type SoftwareIllustration = 'idea' | 'prototype' | 'product' | 'integration' | 'website';
import { tallyStory } from './project-stories/tally';

export interface ServiceSheet {
  path: string;
  title: string;
  introduction: string;
  approach: string;
  workflow: { title: string; lead: string; detail: string; button: string; path: string };
  idea: { title: string; lead: string; detail: string; button: string; path: string; project: typeof tallyStory };
  steps: { title: string; description: string }[];
}

export const softwareSheet: ServiceSheet = {
  path: '/services',
  title: 'Let’s build something useful.',
  introduction: 'Make a workflow easier, or bring an idea to life. We’ll choose a clear first milestone together.',
  approach: 'Fixed-price projects · Written, async collaboration · AI-assisted building',
  workflow: { title: 'Make a workflow easier', lead: 'For the tasks your team keeps doing by hand.', detail: 'A focused tool, automation, or integration.', button: 'Tell me about your workflow', path: '/software/start?path=workflow' },
  idea: { title: 'Bring an idea to life', lead: 'For an idea you want people to try.', detail: 'One core experience, built to explore.', button: 'Tell me about your idea', path: '/software/start?path=idea', project: tallyStory },
  steps: [
    { title: 'Share the situation', description: 'A short brief, in your own words.' },
    { title: 'Review the first milestone', description: 'Scope, deliverables and a fixed price.' },
    { title: 'Agree, then begin', description: 'Work starts after the terms are agreed.' },
  ],
};
