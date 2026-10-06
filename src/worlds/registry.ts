import type { PlanetDefinition } from '../app/PlanetContracts.ts'
import { retryableLoad } from './retryableLoad.ts'

export const PLANET_SLUGS = [
  'voxel',
  'npc-ecs',
  'stretch-squash',
  'drone-fleet',
  'event-horizon',
  'warfront',
  'bitboard',
  'pixel-farm',
  'material-forge',
] as const

export type PlanetSlug = (typeof PLANET_SLUGS)[number]

/** The authored planets sit near the starting sector. Space outside them remains open. */
export const planetDefinitions = [
  {
    slug: 'voxel',
    title: 'Shardfall',
    projectKey: 'voxel-structural-collapse',
    position: { sector: [0, 0, 0], local: [0, 0, -420] },
    radius: 42,
    color: 0xffb020,
    load: retryableLoad(() => import('./voxel.ts')),
  },
  {
    slug: 'npc-ecs',
    title: 'Clockwork City',
    projectKey: 'npc-ecs',
    position: { sector: [0, 0, 0], local: [-470, 45, -500] },
    radius: 44,
    color: 0x6be0d5,
    load: retryableLoad(() => import('./npc-ecs.ts')),
  },
  {
    slug: 'stretch-squash',
    title: 'Elastic Foundry',
    projectKey: 'stretch-squash-rig',
    position: { sector: [0, 0, 0], local: [490, -65, -490] },
    radius: 40,
    color: 0xf472d0,
    load: retryableLoad(() => import('./stretch-squash.ts')),
  },
  {
    slug: 'drone-fleet',
    title: 'Drone Archipelago',
    projectKey: 'drone-vr-simulation',
    position: { sector: [0, 0, 0], local: [730, 70, -170] },
    radius: 46,
    color: 0xff7a2f,
    load: retryableLoad(() => import('./drone-fleet.ts')),
  },
  {
    slug: 'event-horizon',
    title: 'Event Horizon',
    projectKey: 'dots-solar-system',
    position: { sector: [0, 0, 0], local: [-790, -50, -150] },
    radius: 56,
    color: 0xa78bfa,
    load: retryableLoad(() => import('./event-horizon.ts')),
  },
  {
    slug: 'warfront',
    title: 'Warfront',
    projectKey: 'survival-multiplayer',
    position: { sector: [0, 0, 0], local: [590, 15, 590] },
    radius: 48,
    color: 0x4f8cff,
    load: retryableLoad(() => import('./warfront.ts')),
  },
  {
    slug: 'bitboard',
    title: 'Bitboard Moon',
    projectKey: 'bitwise-bitboard',
    position: { sector: [0, 0, 0], local: [-240, 120, 810] },
    radius: 38,
    color: 0xd6dc52,
    load: retryableLoad(() => import('./bitboard.ts')),
  },
  {
    slug: 'pixel-farm',
    title: 'Pixel Farm',
    projectKey: 'alien-farming-simulation',
    position: { sector: [0, 0, 0], local: [340, -80, 900] },
    radius: 43,
    color: 0x3ddc97,
    load: retryableLoad(() => import('./pixel-farm.ts')),
  },
  {
    slug: 'material-forge',
    title: 'Material Forge',
    projectKey: 'maya-texture-linker',
    position: { sector: [0, 0, 0], local: [-900, 75, 550] },
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
