import { bboxCenter, clamp } from '../geo'
import { fetchJson } from '../http'
import { keywordLabel } from '../keywords'
import type { Area, PostGeo, PostMedia } from '../types'
import { AreaSource, type SourceContext } from './base'

type Tweet = {
  id: string
  text: string
  created_at: string
  author_id: string
  geo?: { coordinates?: { coordinates: [number, number] }; place_id?: string }
  attachments?: { media_keys?: string[] }
  public_metrics?: { like_count: number; reply_count: number; retweet_count: number; impression_count?: number }
}
type User = { id: string; name: string; username: string; profile_image_url?: string }
type Place = { id: string; full_name: string; geo?: { bbox?: [number, number, number, number] } }
type Media = { media_key: string; type: string; url?: string; preview_image_url?: string }
type SearchResponse = {
  data?: Tweet[]
  includes?: { users?: User[]; places?: Place[]; media?: Media[] }
  meta?: { newest_id?: string }
}

const MAX_RADIUS_KM = 40 // X caps point_radius at 25 miles

/**
 * X API v2 recent search with `point_radius` (plus the area's keywords when `q` is set).
 * Paid, billed per post read — the default poll is every 15 minutes.
 */
export class XSource extends AreaSource {
  readonly intervalMs: number

  constructor(ctx: SourceContext) {
    super('x', ctx, Boolean(ctx.config.x.bearerToken), 'Set X_BEARER_TOKEN in .env.local (paid X API)')
    this.intervalMs = ctx.config.x.pollMs
  }

  protected async fetchArea(area: Area) {
    const sinceIds = (this.ctx.store.state.xSinceIds ??= {}) as Record<string, string>
    const radiusKm = Number(clamp(area.radiusM / 1000, 0.1, MAX_RADIUS_KM).toFixed(2))
    const terms = area.keywords.filter((keyword) => typeof keyword === 'string').slice(0, 5)
    const geoQuery = `point_radius:[${area.center.lon.toFixed(5)} ${area.center.lat.toFixed(5)} ${radiusKm}km]`
    const query = terms.length
      ? `(${[geoQuery, ...terms.map((term) => `"${keywordLabel(term).replace(/"/g, '')}"`)].join(' OR ')}) -is:retweet`
      : `${geoQuery} -is:retweet`

    const params = new URLSearchParams({
      query,
      max_results: '100',
      'tweet.fields': 'created_at,geo,author_id,public_metrics,attachments',
      expansions: 'author_id,geo.place_id,attachments.media_keys',
      'user.fields': 'name,username,profile_image_url',
      'place.fields': 'full_name,geo',
      'media.fields': 'type,url,preview_image_url',
    })
    const sinceId = sinceIds[area.key]
    if (sinceId) params.set('since_id', sinceId)
    else params.set('start_time', new Date(this.ctx.store.windowStart()).toISOString())

    const response = await fetchJson<SearchResponse>(`https://api.x.com/2/tweets/search/recent?${params}`, {
      headers: { Authorization: `Bearer ${this.ctx.config.x.bearerToken}` },
    })
    if (response.meta?.newest_id) sinceIds[area.key] = response.meta.newest_id

    const users = new Map(response.includes?.users?.map((user) => [user.id, user]))
    const places = new Map(response.includes?.places?.map((place) => [place.id, place]))
    const media = new Map(response.includes?.media?.map((item) => [item.media_key, item]))
    for (const tweet of response.data ?? []) {
      const user = users.get(tweet.author_id)
      this.addPost({
        id: `x:${tweet.id}`,
        source: 'x',
        url: `https://x.com/${user?.username ?? 'i'}/status/${tweet.id}`,
        text: tweet.text,
        createdAt: Date.parse(tweet.created_at),
        author: { id: tweet.author_id, name: user?.name ?? tweet.author_id, handle: user?.username, avatar: user?.profile_image_url },
        media: (tweet.attachments?.media_keys ?? [])
          .map((key) => media.get(key))
          .filter((item): item is Media => Boolean(item?.url || item?.preview_image_url))
          .map((item): PostMedia => ({
            type: item.type === 'photo' ? 'image' : 'video',
            url: item.url ?? item.preview_image_url!,
            preview: item.preview_image_url,
          })),
        geo: tweetGeo(tweet, places),
        stats: {
          likes: tweet.public_metrics?.like_count,
          replies: tweet.public_metrics?.reply_count,
          reposts: tweet.public_metrics?.retweet_count,
          views: tweet.public_metrics?.impression_count,
        },
      })
    }
  }
}

function tweetGeo(tweet: Tweet, places: Map<string, Place>): PostGeo | undefined {
  const point = tweet.geo?.coordinates?.coordinates
  if (point) return { lon: point[0], lat: point[1], precision: 'exact' }
  const place = tweet.geo?.place_id ? places.get(tweet.geo.place_id) : undefined
  const bbox = place?.geo?.bbox
  return bbox ? { ...bboxCenter(bbox), bbox, precision: 'place', placeName: place.full_name } : undefined
}
