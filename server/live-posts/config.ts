import { isAbsolute, resolve } from 'node:path'
import type { Keyword } from './types'

/** Terms that mark a post as being about New York City when no `q` is given. */
export const NYC_KEYWORDS: Keyword[] = [
  'NYC',
  'New York City',
  /new\s+york(?!\s+(?:times|post|magazine|review))/,
  'Manhattan',
  'Brooklyn',
  'Bronx',
  'Staten Island',
  'Queens, NY',
  'Harlem',
  'Times Square',
  'Central Park',
  'Midtown',
  "Hell's Kitchen",
  'Greenwich Village',
  'East Village',
  'Lower East Side',
  'Upper West Side',
  'Upper East Side',
  'Bushwick',
  'Astoria',
  'Flushing',
  'Long Island City',
  'Coney Island',
  'Empire State Building',
  'Rockefeller Center',
  'Grand Central',
  'Penn Station',
  'Brooklyn Bridge',
  'One World Trade',
  'Madison Square Garden',
  'Yankee Stadium',
  'NYC subway',
  'LaGuardia',
  'JFK Airport',
]

export type LivePostsConfig = {
  enabled: boolean
  windowMs: number
  cacheFile: string | null
  areaIdleMs: number
  defaultArea: { name: string; lat: number; lon: number; radiusM: number }
  bluesky: { enabled: boolean; backfillMinutes: number }
  mastodon: { server: string; tags: string[]; pollMs: number }
  youtube: { apiKey?: string; pollMs: number }
  flickr: { apiKey?: string; pollMs: number }
  x: { bearerToken?: string; pollMs: number }
  instagram: { token?: string; userId?: string; graphVersion: string; hashtags: string[]; pollMs: number }
  instagramLocation: { sessionId?: string; csrfToken?: string; dsUserId?: string; pollMs: number }
}

type Env = Record<string, string | undefined>

const text = (env: Env, name: string) => env[name]?.trim() || undefined

function number(env: Env, name: string, fallback: number, min: number, max: number) {
  const value = Number(text(env, name))
  return Number.isFinite(value) && text(env, name) ? Math.min(max, Math.max(min, value)) : fallback
}

const minutes = (env: Env, name: string, fallback: number) => number(env, name, fallback, 1, 24 * 60) * 60_000

const flag = (env: Env, name: string, fallback: boolean) => {
  const value = text(env, name)?.toLowerCase()
  return value ? !['0', 'false', 'off', 'no'].includes(value) : fallback
}

const list = (env: Env, name: string, fallback: string[]) =>
  text(env, name)?.split(',').map((item) => item.trim().replace(/^#/, '')).filter(Boolean) ?? fallback

export function readConfig(env: Env, root: string): LivePostsConfig {
  const cacheFile = text(env, 'LIVE_POSTS_CACHE_FILE') ?? '.cache/live-posts.json'
  return {
    enabled: flag(env, 'LIVE_POSTS_ENABLED', true),
    windowMs: number(env, 'LIVE_POSTS_WINDOW_MINUTES', 60, 5, 24 * 60) * 60_000,
    cacheFile: cacheFile === 'off' ? null : isAbsolute(cacheFile) ? cacheFile : resolve(root, cacheFile),
    areaIdleMs: minutes(env, 'LIVE_POSTS_AREA_IDLE_MINUTES', 20),
    defaultArea: {
      name: text(env, 'LIVE_POSTS_DEFAULT_NAME') ?? 'New York City',
      lat: number(env, 'LIVE_POSTS_DEFAULT_LAT', 40.7128, -90, 90),
      lon: number(env, 'LIVE_POSTS_DEFAULT_LON', -74.006, -180, 180),
      radiusM: number(env, 'LIVE_POSTS_DEFAULT_RADIUS_KM', 25, 0.05, 1000) * 1000,
    },
    bluesky: {
      enabled: flag(env, 'BLUESKY_ENABLED', true),
      backfillMinutes: number(env, 'BLUESKY_BACKFILL_MINUTES', 60, 0, 24 * 60),
    },
    mastodon: {
      server: text(env, 'MASTODON_SERVER') ?? 'mastodon.social',
      tags: list(env, 'MASTODON_TAGS', ['nyc', 'newyork', 'newyorkcity', 'manhattan', 'brooklyn', 'bronx', 'queens', 'statenisland']),
      pollMs: minutes(env, 'MASTODON_POLL_MINUTES', 2),
    },
    youtube: { apiKey: text(env, 'YOUTUBE_API_KEY'), pollMs: minutes(env, 'YOUTUBE_POLL_MINUTES', 20) },
    flickr: { apiKey: text(env, 'FLICKR_API_KEY'), pollMs: minutes(env, 'FLICKR_POLL_MINUTES', 5) },
    x: { bearerToken: text(env, 'X_BEARER_TOKEN'), pollMs: minutes(env, 'X_POLL_MINUTES', 15) },
    instagram: {
      token: text(env, 'INSTAGRAM_GRAPH_TOKEN'),
      userId: text(env, 'INSTAGRAM_USER_ID'),
      graphVersion: text(env, 'INSTAGRAM_GRAPH_VERSION') ?? 'v23.0',
      hashtags: list(env, 'INSTAGRAM_HASHTAGS', ['nyc', 'newyorkcity', 'manhattan', 'brooklyn']),
      pollMs: minutes(env, 'INSTAGRAM_POLL_MINUTES', 10),
    },
    instagramLocation: {
      sessionId: text(env, 'INSTAGRAM_SESSIONID'),
      csrfToken: text(env, 'INSTAGRAM_CSRFTOKEN'),
      dsUserId: text(env, 'INSTAGRAM_DS_USER_ID'),
      pollMs: minutes(env, 'INSTAGRAM_LOCATION_POLL_MINUTES', 10),
    },
  }
}
