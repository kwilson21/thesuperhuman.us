import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(new URL('./tests/__mocks__/cloudflare-workers.ts', import.meta.url)),
      '~': fileURLToPath(new URL('./src', import.meta.url)),
      'astro:middleware': fileURLToPath(new URL('./tests/__mocks__/astro-middleware.ts', import.meta.url)),
    },
  },
  test: {
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: { reporter: ['text', 'html'] },
  },
});
