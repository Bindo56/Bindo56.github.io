import { clamp } from '../geo'
import { fetchJson } from '../http'
import type { Area } from '../types'
import { AreaSource, type SourceContext } from './base'

const API = 'https://www.googleapis.com/youtube/v3'

type SearchResponse = { items: { id: { videoId?: string } }[] }
type Thumbnails = Record<string, { url: string } | undefined>
type Video = {
  id: string
  snippet: {
    publishedAt: string
    channelId: string
    channelTitle: string
    title: string
    description: string
    thumbnails: Thumbnails
    liveBroadcastContent: 'live' | 'upcoming' | 'none'
  }
  recordingDetails?: { location?: { latitude?: number; longitude?: number }; locationDescription?: string }
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
}

/**
 * YouTube Data API location search: videos published in the window whose uploader set a
 * location inside the area. A search costs 100 of the default 10,000 daily quota units.
 */
export class YouTubeSource extends AreaSource {
  readonly intervalMs: number

  constructor(ctx: SourceContext) {
    super('youtube', ctx, Boolean(ctx.config.youtube.apiKey), 'Set YOUTUBE_API_KEY in .env.local')
    this.intervalMs = ctx.config.youtube.pollMs
  }

  protected async fetchArea(area: Area) {
    const key = this.ctx.config.youtube.apiKey!
    const search = await fetchJson<SearchResponse>(
      `${API}/search?${new URLSearchParams({
        part: 'id',
        type: 'video',
        order: 'date',
        maxResults: '50',
        location: `${area.center.lat},${area.center.lon}`,
        locationRadius: `${Math.round(clamp(area.radiusM, 50, 1_000_000))}m`,
        publishedAfter: new Date(this.ctx.store.windowStart()).toISOString(),
        key,
      })}`,
    )
    const ids = search.items.map((item) => item.id.videoId).filter((id): id is string => Boolean(id))
    if (!ids.length) return

    const { items } = await fetchJson<{ items: Video[] }>(
      `${API}/videos?${new URLSearchParams({ part: 'snippet,recordingDetails,statistics', id: ids.join(','), key })}`,
    )
    for (const video of items) {
      const { snippet } = video
      const location = video.recordingDetails?.location
      const exact = typeof location?.latitude === 'number' && typeof location.longitude === 'number'
      const thumbnail = snippet.thumbnails.high?.url ?? snippet.thumbnails.medium?.url ?? snippet.thumbnails.default?.url
      this.addPost({
        id: `youtube:${video.id}`,
        source: 'youtube',
        url: `https://www.youtube.com/watch?v=${video.id}`,
        text: [snippet.title, snippet.description].filter(Boolean).join('\n').slice(0, 1000),
        createdAt: Date.parse(snippet.publishedAt),
        author: { id: snippet.channelId, name: snippet.channelTitle },
        media: thumbnail ? [{ type: 'image', url: thumbnail }] : [],
        // The search guarantees the video is inside the area even when its coordinates are not returned.
        geo: exact
          ? { lat: location.latitude!, lon: location.longitude!, precision: 'exact', placeName: video.recordingDetails?.locationDescription }
          : { ...area.center, precision: 'place', placeName: video.recordingDetails?.locationDescription ?? area.name },
        live: snippet.liveBroadcastContent === 'live',
        stats: {
          views: Number(video.statistics?.viewCount ?? 0),
          likes: Number(video.statistics?.likeCount ?? 0),
          replies: Number(video.statistics?.commentCount ?? 0),
        },
      })
    }
  }
}
