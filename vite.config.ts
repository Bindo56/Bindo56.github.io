import { defineConfig } from 'vite'
import { PLANET_SLUGS } from './src/worlds/planetSlugs.ts'
import { georefApi } from './server/georef/plugin.ts'
import { livePostsApi } from './server/live-posts/plugin.ts'
import { npcProofApi } from './server/population/proof-plugin.ts'
import { npcWeekApi } from './server/population/week-plugin.ts'

export default defineConfig({
  plugins: [livePostsApi(), georefApi(), npcProofApi(), npcWeekApi()],
  build: {
    rollupOptions: {
      input: Object.fromEntries([
        ['main', 'index.html'],
        ...PLANET_SLUGS.map((slug) => [slug, `worlds/${slug}/index.html`]),
        ['clockworkCity', 'worlds/clockwork-city/index.html'],
        ['trainModels', 'worlds/train-models/index.html'],
        ['classic', 'classic/index.html'],
      ]),
    },
  },
})
