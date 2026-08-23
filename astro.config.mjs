// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import { unified } from '@astrojs/markdown-remark';
import remarkAttributes from 'remark-attributes';

export default defineConfig({
  site: 'https://connors-stuff.dev',
  base: '/',
  vite: {
    plugins: [tailwindcss()]
  },
  markdown: {
    processor: unified({
      remarkPlugins: [remarkAttributes],
    }),
  },
  devToolbar: {
    enabled: false
  }
});