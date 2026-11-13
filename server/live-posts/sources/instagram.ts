import { distanceM } from '../geo'
import { fetchJson, HttpError } from '../http'
import type { Area, PostMedia } from '../types'
import { AreaSource, IntervalSource, type SourceContext } from './base'

/* ------------------------------------------------------------------------------------------------
 * 1) Official Instagram Graph API — hashtag search (no location data, no usernames).
 *    Needs an Instagram Business/Creator account linked to a Facebook Page, a Meta app with
 *    "Instagram Public Content Access", and a user access token. Limit: 30 unique hashtags / 7 days.
 * ---------------------------------------------------------------------------------------------- */

type GraphMedia = {
  id: string
  caption?: string
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
  media_url?: string
  permalink: string
  timestamp: string | number
  like_count?: number
  comments_count?: number
}

export class InstagramHashtagSource extends IntervalSource {
  protected readonly intervalMs: number

  constructor(ctx: SourceContext) {
    const { token, userId } = ctx.config.instagram
    super('instagram', ctx, Boolean(token && userId), 'Set INSTAGRAM_GRAPH_TOKEN and INSTAGRAM_USER_ID in .env.local')
    this.intervalMs = ctx.config.instagram.pollMs
  }

  protected async fetchLatest() {
    const { token, userId, graphVersion, hashtags } = this.ctx.config.instagram
    const api = `https://graph.facebook.com/${graphVersion}`
    // Hashtag lookups count against the 30-per-week limit, so their IDs are cached in the snapshot.
    const hashtagIds = (this.ctx.store.state.instagramHashtagIds ??= {}) as Record<string, string>
    let firstError: unknown

    for (const hashtag of hashtags) {
      try {
        if (!hashtagIds[hashtag]) {
          const found = await fetchJson<{ data: { id: string }[] }>(
            `${api}/ig_hashtag_search?${new URLSearchParams({ user_id: userId!, q: hashtag, access_token: token! })}`,
          )
          if (!found.data[0]) continue
          hashtagIds[hashtag] = found.data[0].id
        }
        const { data } = await fetchJson<{ data: GraphMedia[] }>(
          `${api}/${hashtagIds[hashtag]}/recent_media?${new URLSearchParams({
            user_id: userId!,
            fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count',
            limit: '50',
            access_token: token!,
          })}`,
        )
        for (const media of data) {
          const createdAt = typeof media.timestamp === 'number' ? media.timestamp * 1000 : Date.parse(media.timestamp)
          this.addPost({
            id: `instagram:${media.id}`,
            source: 'instagram',
            url: media.permalink,
            text: media.caption ?? '',
            createdAt,
            // The hashtag endpoint does not expose who posted.
            author: { name: 'Instagram user' },
            media: media.media_url ? [{ type: media.media_type === 'VIDEO' ? 'video' : 'image', url: media.media_url }] : [],
            tags: [hashtag],
            stats: { likes: media.like_count, replies: media.comments_count },
          })
        }
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError) throw firstError
  }
}

/* ------------------------------------------------------------------------------------------------
 * 2) Instagram location feed — the "Recent" tab of a place page (e.g. a building).
 *    Unofficial: uses the same web endpoint Instaloader uses and needs a logged-in session cookie
 *    (INSTAGRAM_SESSIONID from your browser). Against Instagram's terms; can break or flag the
 *    account, so it polls slowly.
 * ---------------------------------------------------------------------------------------------- */

const WEB = 'https://www.instagram.com'
const WEB_APP_ID = '936619743392459'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const MAX_PAGES = 3

type IgPlace = { pk: string; name: string; lat?: number; lng?: number }
type IgMedia = {
  pk: string | number
  code: string
  taken_at: number
  media_type: number
  caption?: { text?: string } | null
  user?: { pk?: string | number; username?: string; full_name?: string; profile_pic_url?: string }
  image_versions2?: { candidates?: { url: string }[] }
  video_versions?: { url: string }[] | null
  carousel_media?: IgMedia[]
  location?: { pk?: string | number; name?: string; lat?: number; lng?: number }
  like_count?: number
  comment_count?: number
}
type RecentFeed = { sections?: unknown[]; more_available?: boolean; next_max_id?: string }

export class InstagramLocationSource extends AreaSource {
  readonly intervalMs: number

  constructor(ctx: SourceContext) {
    super(
      'instagram-location',
      ctx,
      Boolean(ctx.config.instagramLocation.sessionId),
      'Set INSTAGRAM_SESSIONID (browser cookie) in .env.local',
    )
    this.intervalMs = ctx.config.instagramLocation.pollMs
  }

  protected async fetchArea(area: Area) {
    const locationIds = area.igLocationIds.length ? area.igLocationIds : await this.resolvePlaces(area)
    if (!locationIds.length) {
      this.setNote(`No Instagram place found near "${area.name}"; pass ig=<location id>`)
      return
    }
    this.setNote(undefined)
    for (const id of locationIds) await this.fetchLocation(id)
  }

  /** Finds Instagram place IDs for the area name that sit inside the area (cached per name). */
  private async resolvePlaces(area: Area) {
    const cache = (this.ctx.store.state.instagramPlaces ??= {}) as Record<string, IgPlace[]>
    const cacheKey = area.name.toLowerCase()
    if (!cache[cacheKey]) {
      const result = await this.get<{ places?: { place?: { location?: IgPlace } }[] }>(
        `${WEB}/web/search/topsearch/?${new URLSearchParams({ context: 'blended', query: area.name, include_reel: 'false', __a: '1' })}`,
      )
      cache[cacheKey] = (result.places ?? []).map((entry) => entry.place?.location).filter((place): place is IgPlace => Boolean(place?.pk))
    }
    const maxDistance = Math.max(area.radiusM, 750)
    return cache[cacheKey]
      .filter((place) => place.lat !== undefined && place.lng !== undefined)
      .map((place) => ({ id: String(place.pk), distance: distanceM(area.center, { lat: place.lat!, lon: place.lng! }) }))
      .filter((place) => place.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map((place) => place.id)
  }

  private async fetchLocation(locationId: string) {
    const windowStart = this.ctx.store.windowStart()
    let maxId: string | undefined
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams({ __a: '1', __d: 'dis' })
      if (maxId) params.set('max_id', maxId)
      const data = await this.get<{ native_location_data?: { recent?: RecentFeed } }>(
        `${WEB}/explore/locations/${encodeURIComponent(locationId)}/?${params}`,
      )
      const recent = data.native_location_data?.recent
      const medias: IgMedia[] = []
      collectMedia(recent?.sections, medias, 0)
      for (const media of medias) this.addMedia(media)
      const oldest = Math.min(...medias.map((media) => media.taken_at * 1000))
      if (!recent?.more_available || !recent.next_max_id || !medias.length || oldest < windowStart) break
      maxId = recent.next_max_id
    }
  }

  private addMedia(media: IgMedia) {
    const user = media.user ?? {}
    const location = media.location
    this.addPost({
      id: `instagram-location:${media.pk}`,
      source: 'instagram-location',
      url: `${WEB}/p/${media.code}/`,
      text: media.caption?.text ?? '',
      createdAt: media.taken_at * 1000,
      author: { id: user.pk ? String(user.pk) : undefined, name: user.full_name || user.username || 'Instagram user', handle: user.username, avatar: user.profile_pic_url },
      media: igMedia(media),
      geo:
        typeof location?.lat === 'number' && typeof location.lng === 'number'
          ? { lat: location.lat, lon: location.lng, precision: 'place', placeName: location.name }
          : undefined,
      stats: { likes: media.like_count, replies: media.comment_count },
    })
  }

  private async get<T>(url: string): Promise<T> {
    const { sessionId, csrfToken, dsUserId } = this.ctx.config.instagramLocation
    const cookies = [`sessionid=${sessionId}`, csrfToken && `csrftoken=${csrfToken}`, dsUserId && `ds_user_id=${dsUserId}`]
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Cookie: cookies.filter(Boolean).join('; '),
        'User-Agent': USER_AGENT,
        'X-IG-App-ID': WEB_APP_ID,
        'X-Requested-With': 'XMLHttpRequest',
        ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
        Referer: `${WEB}/`,
        Accept: 'application/json',
      },
    })
    if (response.status >= 300 && response.status < 400) {
      const target = response.headers.get('location') ?? ''
      throw new HttpError(response.status, target.includes('/accounts/login') ? 'Instagram session expired; refresh INSTAGRAM_SESSIONID' : `Instagram redirected (${response.status})`)
    }
    const body = await response.text()
    if (!response.ok) throw new HttpError(response.status, `Instagram HTTP ${response.status}: ${body.replace(/\s+/g, ' ').slice(0, 200)}`)
    try {
      return JSON.parse(body) as T
    } catch {
      throw new Error('Instagram returned HTML instead of JSON (session may be invalid)')
    }
  }
}

/** Instagram nests media in several section layouts; pick out anything shaped like a post. */
function collectMedia(node: unknown, out: IgMedia[], depth: number) {
  if (!node || typeof node !== 'object' || depth > 8) return
  if (Array.isArray(node)) {
    for (const item of node) collectMedia(item, out, depth + 1)
    return
  }
  const record = node as Record<string, unknown>
  if (record.code && record.taken_at && record.pk) {
    out.push(record as unknown as IgMedia)
    return
  }
  for (const value of Object.values(record)) collectMedia(value, out, depth + 1)
}

function igMedia(media: IgMedia): PostMedia[] {
  const items = media.carousel_media?.length ? media.carousel_media : [media]
  return items
    .map((item): PostMedia | null => {
      const image = item.image_versions2?.candidates?.[0]?.url
      const video = item.video_versions?.[0]?.url
      if (video) return { type: 'video', url: video, preview: image }
      return image ? { type: 'image', url: image } : null
    })
    .filter((item): item is PostMedia => item !== null)
}
