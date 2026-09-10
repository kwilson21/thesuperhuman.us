import { audioServices } from './audio';
import type { AudioService } from '~/lib/audio-tracks';
export type SoftwareIllustration = 'idea' | 'prototype' | 'product' | 'integration' | 'website';

export interface ServiceSheet {
  kind: 'software' | 'audio'; title: string; introduction: string; approach: string;
  offerings: { label: string; description: string; illustration?: SoftwareIllustration; service?: AudioService; evidence?: string }[];
  background: string; working: string; starting: string; closing: string;
  contact: string; contactLabel: string; evidence: string; evidenceLabel: string;
  path: string;
}

export const softwareSheet: ServiceSheet = {
  kind: 'software', path: '/services',
  title: 'Software engineering',
  introduction: 'Bring an idea or a problem. Let’s turn it into something useful.',
  approach: 'AI-assisted building, backed by production engineering experience.',
  offerings: [
    { label: 'Prototypes', description: 'An idea made tangible enough to try.', illustration: 'prototype' },
    { label: 'Products & internal tools', description: 'Useful software, refined with the people using it.', illustration: 'product' },
    { label: 'Website design', description: 'Clear structure, visual storytelling and responsive pages.', illustration: 'website' },
    { label: 'Integrations', description: 'Connect systems and simplify a workflow.', illustration: 'integration' },
  ],
  background: '7+ years in software engineering · Lyft · Sure · Axuall',
  working: 'Fixed-price projects. Clear deliverables. Written, async collaboration.',
  closing: 'Have something in mind?',
  starting: 'Share the idea, who it is for, and your timing.',
  contact: '/#contact', contactLabel: 'Discuss a software project',
  evidence: '/work', evidenceLabel: 'Explore my work history',
};

export const audioSheet: ServiceSheet = {
  kind: 'audio', path: '/audio/services',
  title: 'Audio engineering',
  introduction: 'Help your recording take shape.',
  approach: 'Mixing, mastering, production and remote recording support.',
  offerings: Object.entries(audioServices).map(([service, item]) => ({ ...item, service: service as AudioService })),
  background: 'Audio production · Middle Tennessee State University',
  working: 'Fixed-price projects with agreed deliverables, references and revisions.',
  closing: 'Tell me about the music.',
  starting: 'Share what stage it is at, what you need, and your timing.',
  contact: '/audio/#book', contactLabel: 'Discuss an audio project',
  evidence: '/audio/', evidenceLabel: 'Explore audio engineering',
};
