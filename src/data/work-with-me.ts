import type { ImageMetadata } from 'astro';
import mixing from '~/assets/site/work-with-me-mixing.webp';
import website from '~/assets/site/work-with-me-website.webp';
import software from '~/assets/site/work-with-me-software.webp';

/**
 * The three things a visitor can hire Kazon for. Shown as doors on Home and on the
 * Work with me hub. Each picture is real, verifiable work: a released record, this
 * live site, a public demo. A prototype earns a door only once it has a public demo.
 * Each button starts the conversation: the audio intake, or the contact form.
 */
export interface Door {
  id: 'mixing' | 'website' | 'software';
  title: string;
  line: string;
  href: string;
  label: string;
  picture: ImageMetadata;
  caption: string;
}

export const doors: Door[] = [
  {
    id: 'mixing', title: 'Mixing & mastering',
    line: 'Two-track vocal mixing from $150, mastering from $75.',
    href: '/audio/start', label: 'Start your song',
    picture: mixing, caption: 'Old News · vocal mix and master by Kazon',
  },
  {
    id: 'website', title: 'Website design',
    line: 'Clear structure, visual storytelling and responsive pages.',
    href: '/#contact', label: 'Plan your website',
    picture: website, caption: 'This site, redesigned September 2026',
  },
  {
    id: 'software', title: 'Software engineering',
    line: 'Prototypes, products, internal tools and integrations.',
    href: '/#contact', label: 'Discuss your project',
    picture: software, caption: 'Tally · a budgeting app, public demo',
  },
];
