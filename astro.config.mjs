// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://thesuperhuman.us',
  output: 'static',
  adapter: cloudflare({
    imageService: 'compile',
    platformProxy: { enabled: true },
  }),
  integrations: [tailwind({ applyBaseStyles: false }), sitemap()],
  vite: {
    server: {
      allowedHosts: ['thesuperhuman.us', 'www.thesuperhuman.us', 'audio.thesuperhuman.us'],
    },
  },
});
