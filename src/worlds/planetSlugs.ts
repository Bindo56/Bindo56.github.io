/** Shared route list kept free of dynamic world imports for the Vite build config. */
export const PLANET_SLUGS = [
  'voxel',
  'stretch-squash',
  'warfront',
  'npc-ecs',
  'drone-fleet',
  'event-horizon',
  'bitboard',
  'pixel-farm',
  'material-forge',
] as const

export type PlanetSlug = (typeof PLANET_SLUGS)[number]
