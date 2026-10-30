import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const contact = readFileSync(new URL('../../src/components/ContactForm.astro', import.meta.url), 'utf8');
const home = readFileSync(new URL('../../src/pages/index.astro', import.meta.url), 'utf8');

it('loads the Contact Turnstile SDK only after the collapsed disclosure opens', () => {
	expect(contact).not.toContain('src="https://challenges.cloudflare.com/turnstile/v0/api.js"');
	expect(home).toContain('message.addEventListener(\'toggle\'');
	expect(home).toContain('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
});
