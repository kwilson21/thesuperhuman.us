// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://thesuperhuman.us',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  compressHTML: true,
  adapter: cloudflare({
    imageService: 'compile',
    platformProxy: { enabled: true },
  }),
  integrations: [
    tailwind({ applyBaseStyles: false }),
    sitemap({
      changefreq: 'monthly',
      priority: 0.7,
      lastmod: new Date(),
      // Exclude API routes and the /notes index. The notes index is a
      // list of links with no unique content of its own; the value lives
      // in the individual posts, which are listed in the sitemap on their
      // own. Google will still discover /notes via internal links.
      filter: (page) =>
        !page.includes('/api/') &&
        !/^https:\/\/thesuperhuman\.us\/notes\/?$/.test(page),
    }),
  ],
});
