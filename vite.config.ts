import { defineConfig } from 'vite'
import { PLANET_SLUGS } from './src/worlds/registry.ts'

export default defineConfig({
  build: {
    rollupOptions: {
      input: Object.fromEntries([
        ['main', 'index.html'],
        ...PLANET_SLUGS.map((slug) => [slug, `worlds/${slug}/index.html`]),
      ]),
    },
  },
})
