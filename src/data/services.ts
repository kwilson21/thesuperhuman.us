export type SoftwareIllustration = 'idea' | 'prototype' | 'product' | 'integration' | 'website';

export interface ServiceSheet {
  title: string; introduction: string; approach: string;
  offerings: { id?: string; label: string; description: string; illustration: SoftwareIllustration; evidence?: string }[];
  background: string; working: string; starting: string; closing: string;
  contact: string; contactLabel: string; evidence: string; evidenceLabel: string;
  path: string;
}

export const softwareSheet: ServiceSheet = {
  path: '/services',
  title: 'Software engineering',
  introduction: 'Bring an idea or a problem. Let’s turn it into something useful.',
  approach: 'AI-assisted building, backed by production engineering experience.',
  offerings: [
    { label: 'Prototypes', description: 'An idea made tangible enough to try.', illustration: 'prototype' },
    { label: 'Products & internal tools', description: 'Useful software, refined with the people using it.', illustration: 'product' },
    { id: 'website-design', label: 'Website design', description: 'Clear structure, visual storytelling and responsive pages.', illustration: 'website', evidence: '/building/personal-website' },
    { label: 'Integrations', description: 'Connect systems and simplify a workflow.', illustration: 'integration' },
  ],
  background: '7+ years in software engineering · Lyft · Sure · Axuall',
  working: 'Fixed-price projects. Clear deliverables. Written, async collaboration.',
  closing: 'Have something in mind?',
  starting: 'Share the idea, who it is for, and your timing.',
  contact: '/#contact', contactLabel: 'Discuss your project',
  evidence: '/work', evidenceLabel: 'Explore my work history',
};
