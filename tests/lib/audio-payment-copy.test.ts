import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('audio payment copy', () => {
  it('explains secure invoicing after offer approval', () => {
    const start = read('src/pages/audio/start.astro');
    const services = read('src/pages/audio/services.astro');

    expect(start).toContain('a secure Stripe invoice books the project');
    expect(start).toContain('Nothing is booked until the deposit invoice is paid.');
    expect(services).toContain('You pay through a secure Stripe invoice.');
    expect(services).toContain('Balance before final files.');
  });

  it('does not embed a generic checkout or load Stripe client code', () => {
    const pages = `${read('src/pages/audio/start.astro')}\n${read('src/pages/audio/services.astro')}`;
    expect(pages).not.toContain('buy.stripe.com');
    expect(pages).not.toContain('js.stripe.com');
    expect(pages).not.toContain('STRIPE_SECRET');
  });
});
