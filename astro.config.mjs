// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import { publicReleasePages, shouldIncludeSitemapPage } from './scripts/sitemap-pages.mjs';

export default defineConfig({
  site: 'https://thesuperhuman.us',
  devToolbar: { enabled: false },
  output: 'static',
  // middleware.ts retains form-origin protection, with a narrow OAuth token exception.
  security: { checkOrigin: false },
  adapter: cloudflare({
    imageService: 'compile',
    platformProxy: { enabled: true, ...(process.env.MUSIC_PREVIEW_CONFIG ? { configPath: process.env.MUSIC_PREVIEW_CONFIG } : {}) },
  }),
  integrations: [tailwind({ applyBaseStyles: false }), sitemap({ customPages: publicReleasePages(new URL('./src/content/releases/', import.meta.url), 'https://thesuperhuman.us'), filter: shouldIncludeSitemapPage })],
  vite: {
    server: {
      allowedHosts: ['thesuperhuman.us', 'www.thesuperhuman.us', 'audio.thesuperhuman.us'],
    },
  },
});
