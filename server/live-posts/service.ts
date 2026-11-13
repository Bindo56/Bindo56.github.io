import { NYC_KEYWORDS, type LivePostsConfig } from './config'
import { distanceToGeo, parseDistance } from './geo'
import { sleep } from './http'
import { compileAny, compileTerms, keywordLabel, parseKeywords, type TermMatcher } from './keywords'
import { PostStore } from './store'
import { AreaSource, StreamSource, type SourceContext } from './sources/base'
import { BlueskySource } from './sources/bluesky'
import { FlickrSource } from './sources/flickr'
import { InstagramHashtagSource, InstagramLocationSource } from './sources/instagram'
import { MastodonSource } from './sources/mastodon'
import { XSource } from './sources/x'
import { YouTubeSource } from './sources/youtube'
import { SOURCE_IDS, type Area, type MatchedPost, type SourceId, type SourceStatus } from './types'

export class BadRequest extends Error {}

export type PostQuery = {
  lat: number
  lon: number
  radiusM: number
  name?: string
  keywords: string[]
  igLocationIds: string[]
  minutes: number
  sources: SourceId[] | null
  geoOnly: boolean
  limit: number
  waitMs: number
}

type WatchedArea = {
  area: Area
  pinned: boolean
  lastRequestedAt: number
  lastPolledAt: Map<SourceId, number>
  inflight: Map<SourceId, Promise<void>>
  matchTerms: TermMatcher
}

const TICK_MS = 30_000

export class LivePostsService {
  readonly store: PostStore
  private readonly config: LivePostsConfig
  private readonly log: (message: string) => void
  private readonly streams: StreamSource[]
  private readonly areaSources: AreaSource[]
  private readonly areas = new Map<string, WatchedArea>()
  private watchedPattern: RegExp | null = null
  private timers: ReturnType<typeof setInterval>[] = []
  private stopped = false

  constructor(config: LivePostsConfig, log: (message: string) => void) {
    this.config = config
    this.log = log
    this.store = new PostStore(config.windowMs, config.cacheFile)
    const ctx: SourceContext = {
      config,
      store: this.store,
      matchesWatched: (text) => this.watchedPattern?.test(text) ?? false,
      log,
    }
    this.streams = [new BlueskySource(ctx), new MastodonSource(ctx), new InstagramHashtagSource(ctx)]
    this.areaSources = [new YouTubeSource(ctx), new FlickrSource(ctx), new XSource(ctx), new InstagramLocationSource(ctx)]
  }

  start() {
    this.store.load()
    const { name, lat, lon, radiusM } = this.config.defaultArea
    this.watch({ name, center: { lat, lon }, radiusM, keywords: NYC_KEYWORDS, igLocationIds: [] }, true)
    for (const source of this.streams) source.start()
    this.timers.push(setInterval(() => this.tick(), TICK_MS))
    const on = [...this.streams, ...this.areaSources].filter((source) => source.enabled).map((source) => source.id)
    this.log(`collecting the last ${this.config.windowMs / 60_000} min from: ${on.join(', ')} (GET /api/live-posts)`)
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
    for (const source of this.streams) source.stop()
    this.saveSnapshot()
  }

  async query(query: PostQuery) {
    const keywords = query.keywords.length ? query.keywords : NYC_KEYWORDS
    const name = query.name ?? query.keywords[0] ?? this.config.defaultArea.name
    const { watched, isNew } = this.watch(
      { name, center: { lat: query.lat, lon: query.lon }, radiusM: query.radiusM, keywords, igLocationIds: query.igLocationIds },
      false,
    )
    const polls = this.pollArea(watched, isNew)
    // A brand-new area has no location results yet; give the first searches a moment.
    if (isNew && query.waitMs > 0) await Promise.race([polls, sleep(query.waitMs)])

    const now = Date.now()
    const since = Math.max(now - query.minutes * 60_000, this.store.windowStart(now))
    const { area } = watched
    const matched: MatchedPost[] = []
    for (const post of this.store.list(since)) {
      if (query.sources && !query.sources.includes(post.source)) continue
      if (post.geo) {
        const distance = distanceToGeo(area.center, post.geo)
        if (distance <= area.radiusM) {
          matched.push({ ...post, match: { by: 'geo', distanceM: Math.round(distance) } })
          continue
        }
      }
      if (query.geoOnly) continue
      const terms = watched.matchTerms(`${post.text}\n${(post.tags ?? []).map((tag) => `#${tag}`).join(' ')}`)
      if (terms.length) matched.push({ ...post, match: { by: 'keyword', terms } })
    }

    return {
      area: {
        name: area.name,
        lat: area.center.lat,
        lon: area.center.lon,
        radiusM: Math.round(area.radiusM),
        keywords: area.keywords.map(keywordLabel),
        igLocationIds: area.igLocationIds,
      },
      window: { from: new Date(since).toISOString(), to: new Date(now).toISOString(), minutes: Math.round((now - since) / 60_000) },
      total: matched.length,
      count: Math.min(matched.length, query.limit),
      bySource: countBy(matched),
      posts: matched.slice(0, query.limit),
      sources: this.sourceStatuses(),
    }
  }

  status() {
    return {
      windowMinutes: this.config.windowMs / 60_000,
      storedPosts: this.store.size,
      storedBySource: this.store.countBySource(),
      areas: [...this.areas.values()].map(({ area, pinned, lastRequestedAt, lastPolledAt }) => ({
        name: area.name,
        lat: area.center.lat,
        lon: area.center.lon,
        radiusM: Math.round(area.radiusM),
        keywords: area.keywords.map(keywordLabel),
        pinned,
        lastRequestedAt: new Date(lastRequestedAt).toISOString(),
        lastPolledAt: Object.fromEntries([...lastPolledAt].map(([id, at]) => [id, new Date(at).toISOString()])),
      })),
      sources: this.sourceStatuses(),
    }
  }

  private sourceStatuses() {
    const statuses = {} as Record<SourceId, SourceStatus & { pollMinutes?: number }>
    for (const source of this.streams) statuses[source.id] = source.status()
    for (const source of this.areaSources) statuses[source.id] = { ...source.status(), pollMinutes: source.intervalMs / 60_000 }
    return statuses
  }

  private watch(spec: Omit<Area, 'key'>, pinned: boolean) {
    const key = [
      spec.center.lat.toFixed(5),
      spec.center.lon.toFixed(5),
      Math.round(spec.radiusM),
      spec.keywords.map(keywordLabel).join('|').toLowerCase(),
      spec.igLocationIds.join('|'),
    ].join(',')
    const existing = this.areas.get(key)
    if (existing) {
      existing.lastRequestedAt = Date.now()
      return { watched: existing, isNew: false }
    }
    const watched: WatchedArea = {
      area: { ...spec, key },
      pinned,
      lastRequestedAt: Date.now(),
      lastPolledAt: new Map(),
      inflight: new Map(),
      matchTerms: compileTerms(spec.keywords),
    }
    this.areas.set(key, watched)
    this.refreshWatchedPattern()
    if (pinned) void this.pollArea(watched, true)
    return { watched, isNew: true }
  }

  /** Starts any due location searches for the area; resolves when they finish. */
  private pollArea(watched: WatchedArea, force: boolean) {
    const now = Date.now()
    const running: Promise<void>[] = []
    for (const source of this.areaSources) {
      if (!source.enabled) continue
      const inflight = watched.inflight.get(source.id)
      if (inflight) {
        running.push(inflight)
        continue
      }
      const last = watched.lastPolledAt.get(source.id) ?? 0
      if (!force && now - last < source.intervalMs) continue
      watched.lastPolledAt.set(source.id, now)
      const poll = source.poll(watched.area).finally(() => watched.inflight.delete(source.id))
      watched.inflight.set(source.id, poll)
      running.push(poll)
    }
    return Promise.all(running).then(() => undefined)
  }

  private tick() {
    const now = Date.now()
    let removed = false
    for (const [key, watched] of this.areas) {
      if (!watched.pinned && now - watched.lastRequestedAt > this.config.areaIdleMs) {
        this.areas.delete(key)
        removed = true
        continue
      }
      void this.pollArea(watched, false)
    }
    if (removed) this.refreshWatchedPattern()
    this.saveSnapshot()
  }

  private refreshWatchedPattern() {
    this.watchedPattern = compileAny([...this.areas.values()].flatMap(({ area }) => area.keywords))
  }

  private saveSnapshot() {
    try {
      this.store.save()
    } catch (error) {
      this.log(`could not save snapshot: ${String(error)}`)
    }
  }
}

function countBy(posts: MatchedPost[]) {
  const counts: Partial<Record<SourceId, number>> = {}
  for (const post of posts) counts[post.source] = (counts[post.source] ?? 0) + 1
  return counts
}

const number = (params: URLSearchParams, name: string, fallback: number, min: number, max: number) => {
  const raw = params.get(name)
  if (raw === null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) throw new BadRequest(`"${name}" must be between ${min} and ${max}`)
  return value
}

export function parsePostQuery(params: URLSearchParams, config: LivePostsConfig): PostQuery {
  const fallback = config.defaultArea
  let radiusM: number
  try {
    radiusM = parseDistance(params.get('radius'), fallback.radiusM)
  } catch (error) {
    throw new BadRequest((error as Error).message)
  }
  if (radiusM < 10 || radiusM > 1_000_000) throw new BadRequest('"radius" must be between 10m and 1000km')

  const sources = params.get('sources')?.split(',').map((source) => source.trim()).filter(Boolean)
  const unknown = sources?.filter((source) => !SOURCE_IDS.includes(source as SourceId))
  if (unknown?.length) throw new BadRequest(`Unknown source(s): ${unknown.join(', ')}. Use: ${SOURCE_IDS.join(', ')}`)

  return {
    lat: number(params, 'lat', fallback.lat, -90, 90),
    lon: number(params, 'lon', fallback.lon, -180, 180),
    radiusM,
    name: params.get('name')?.trim() || undefined,
    keywords: parseKeywords(params.get('q')),
    igLocationIds: (params.get('ig') ?? '').split(',').map((id) => id.trim()).filter((id) => /^\d+$/.test(id)),
    minutes: number(params, 'minutes', config.windowMs / 60_000, 1, config.windowMs / 60_000),
    sources: sources?.length ? (sources as SourceId[]) : null,
    geoOnly: ['1', 'true'].includes(params.get('geoOnly') ?? ''),
    limit: number(params, 'limit', 500, 1, 5000),
    waitMs: number(params, 'wait', 8000, 0, 20_000),
  }
}
