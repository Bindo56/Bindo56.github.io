import { defineConfig } from 'vite'
import { PLANET_SLUGS } from './src/worlds/planetSlugs.ts'

export default defineConfig({
  build: {
    rollupOptions: {
      input: Object.fromEntries([
        ['main', 'index.html'],
        ...PLANET_SLUGS.map((slug) => [slug, `worlds/${slug}/index.html`]),
        ['clockworkCity', 'worlds/clockwork-city/index.html'],
      ]),
    },
  },
})
