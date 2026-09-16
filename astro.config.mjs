// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://thesuperhuman.us',
  devToolbar: { enabled: false },
  output: 'static',
  // middleware.ts retains form-origin protection, with a narrow OAuth token exception.
  security: { checkOrigin: false },
  adapter: cloudflare({
    imageService: 'compile',
    platformProxy: { enabled: true },
  }),
  integrations: [tailwind({ applyBaseStyles: false }), sitemap({
    // The legacy service URL redirects; sitemap entries should be canonical pages.
    filter: page => new URL(page).pathname.replace(/\/$/, '') !== '/services.html',
    serialize: item => {
      const url = new URL(item.url);
      if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '');
      return { ...item, url: url.href };
    },
  })],
  vite: {
    server: {
      allowedHosts: ['thesuperhuman.us', 'www.thesuperhuman.us', 'audio.thesuperhuman.us'],
    },
  },
});
