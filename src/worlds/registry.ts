import type { OrbitDefinition, PlanetDefinition } from '../app/PlanetContracts.ts'
import { initialOrbitPosition } from '../space/OrbitSystem.ts'
import { retryableLoad } from './retryableLoad.ts'

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

/** Nine rings form three project families. Phase sets the opening composition. */
export const orbitDefinitions = {
  voxel: { radius: 260, phase: 1.43, inclination: 0.025, periodSeconds: 480, group: 'gameplay', glyph: 'VX', linePattern: 'solid' },
  'stretch-squash': { radius: 350, phase: 1.93, inclination: -0.04, periodSeconds: 555, group: 'gameplay', glyph: 'EL', linePattern: 'solid' },
  warfront: { radius: 440, phase: 1.12, inclination: 0.055, periodSeconds: 630, group: 'gameplay', glyph: 'WF', linePattern: 'solid' },
  'npc-ecs': { radius: 540, phase: 4.0, inclination: -0.035, periodSeconds: 705, group: 'simulation', glyph: 'NP', linePattern: 'dashed' },
  'drone-fleet': { radius: 640, phase: 3.0, inclination: 0.07, periodSeconds: 780, group: 'simulation', glyph: 'DR', linePattern: 'dashed' },
  'event-horizon': { radius: 740, phase: 5.25, inclination: -0.06, periodSeconds: 855, group: 'simulation', glyph: 'DT', linePattern: 'dashed' },
  bitboard: { radius: 840, phase: 0, inclination: 0.045, periodSeconds: 930, group: 'engineering', glyph: 'BW', linePattern: 'dotted' },
  'pixel-farm': { radius: 940, phase: 3.6, inclination: -0.075, periodSeconds: 1005, group: 'engineering', glyph: 'PX', linePattern: 'dotted' },
  'material-forge': { radius: 1040, phase: 5.8, inclination: 0.035, periodSeconds: 1080, group: 'engineering', glyph: 'MT', linePattern: 'dotted' },
} as const satisfies Record<PlanetSlug, OrbitDefinition>

/** The authored planets sit near the starting sector. Space outside them remains open. */
export const planetDefinitions = [
  {
    slug: 'voxel',
    title: 'Shardfall',
    projectKey: 'voxel-structural-collapse',
    position: initialOrbitPosition(orbitDefinitions.voxel),
    orbit: orbitDefinitions.voxel,
    radius: 42,
    color: 0xffb020,
    load: retryableLoad(() => import('./voxel.ts')),
  },
  {
    slug: 'stretch-squash',
    title: 'Elastic Foundry',
    projectKey: 'stretch-squash-rig',
    position: initialOrbitPosition(orbitDefinitions['stretch-squash']),
    orbit: orbitDefinitions['stretch-squash'],
    radius: 40,
    color: 0xf472d0,
    load: retryableLoad(() => import('./stretch-squash.ts')),
  },
  {
    slug: 'warfront',
    title: 'Warfront',
    projectKey: 'survival-multiplayer',
    position: initialOrbitPosition(orbitDefinitions.warfront),
    orbit: orbitDefinitions.warfront,
    radius: 48,
    color: 0x4f8cff,
    load: retryableLoad(() => import('./warfront.ts')),
  },
  {
    slug: 'npc-ecs',
    title: 'Clockwork City',
    projectKey: 'npc-ecs',
    position: initialOrbitPosition(orbitDefinitions['npc-ecs']),
    orbit: orbitDefinitions['npc-ecs'],
    radius: 44,
    color: 0x6be0d5,
    load: retryableLoad(() => import('./npc-ecs.ts')),
  },
  {
    slug: 'drone-fleet',
    title: 'Drone Archipelago',
    projectKey: 'drone-vr-simulation',
    position: initialOrbitPosition(orbitDefinitions['drone-fleet']),
    orbit: orbitDefinitions['drone-fleet'],
    radius: 46,
    color: 0xff7a2f,
    load: retryableLoad(() => import('./drone-fleet.ts')),
  },
  {
    slug: 'event-horizon',
    title: 'Solar DOTS',
    projectKey: 'dots-solar-system',
    position: initialOrbitPosition(orbitDefinitions['event-horizon']),
    orbit: orbitDefinitions['event-horizon'],
    radius: 56,
    color: 0xa78bfa,
    load: retryableLoad(() => import('./event-horizon.ts')),
  },
  {
    slug: 'bitboard',
    title: 'Bitboard Moon',
    projectKey: 'bitwise-bitboard',
    position: initialOrbitPosition(orbitDefinitions.bitboard),
    orbit: orbitDefinitions.bitboard,
    radius: 38,
    color: 0xd6dc52,
    load: retryableLoad(() => import('./bitboard.ts')),
  },
  {
    slug: 'pixel-farm',
    title: 'Pixel Farm',
    projectKey: 'alien-farming-simulation',
    position: initialOrbitPosition(orbitDefinitions['pixel-farm']),
    orbit: orbitDefinitions['pixel-farm'],
    radius: 43,
    color: 0x3ddc97,
    load: retryableLoad(() => import('./pixel-farm.ts')),
  },
  {
    slug: 'material-forge',
    title: 'Material Forge',
    projectKey: 'maya-texture-linker',
    position: initialOrbitPosition(orbitDefinitions['material-forge']),
    orbit: orbitDefinitions['material-forge'],
    radius: 43,
    color: 0x26c6b6,
    load: retryableLoad(() => import('./material-forge.ts')),
  },
] as const satisfies readonly PlanetDefinition[]

export type AppRoute =
  | { kind: 'space' }
  | { kind: 'world'; planet: PlanetDefinition }
  | { kind: 'unknown'; pathname: string }

export function getPlanetBySlug(slug: string): PlanetDefinition | undefined {
  return planetDefinitions.find((planet) => planet.slug === slug)
}

/** Uses the configured Vite base so links also work if the site moves under a repository path. */
export function pathForPlanet(planet: PlanetDefinition): string {
  const base = normalizePath(import.meta.env.BASE_URL)
  return `${base === '/' ? '' : base.slice(0, -1)}/worlds/${planet.slug}/`
}

export function getPlanetByPath(pathname: string): PlanetDefinition | undefined {
  const route = parseRoute(pathname)
  return route.kind === 'world' ? route.planet : undefined
}

export function parseRoute(pathname: string): AppRoute {
  const base = normalizePath(import.meta.env.BASE_URL)
  const path = normalizePath(pathname.split(/[?#]/, 1)[0] || '/')
  const relative = base === '/'
    ? path
    : path === base || path === `${base}index.html/`
      ? '/'
      : path.startsWith(base)
        ? `/${path.slice(base.length)}`
        : path

  if (relative === '/' || relative === '/index.html/') return { kind: 'space' }

  const match = /^\/worlds\/([a-z0-9-]+)\/(?:index\.html\/)?$/.exec(relative)
  const planet = match ? getPlanetBySlug(match[1]) : undefined
  return planet ? { kind: 'world', planet } : { kind: 'unknown', pathname: path }
}

function normalizePath(path: string): string {
  const leading = path.startsWith('/') ? path : `/${path}`
  return `${leading.replace(/\/{2,}/g, '/').replace(/\/$/, '')}/`
}
