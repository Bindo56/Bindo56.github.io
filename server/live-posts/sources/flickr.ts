import { clamp } from '../geo'
import { fetchJson, stripHtml } from '../http'
import type { Area } from '../types'
import { AreaSource, type SourceContext } from './base'

type Photo = {
  id: string
  owner: string
  ownername?: string
  title: string
  description?: { _content: string }
  dateupload: string
  latitude: string | number
  longitude: string | number
  accuracy: string | number
  tags?: string
  url_m?: string
  media?: string
}
type SearchResponse = { stat: 'ok'; photos: { photo: Photo[] } } | { stat: 'fail'; message: string }

/** Flickr geotagged photos uploaded inside the area during the window. Free API key. */
export class FlickrSource extends AreaSource {
  readonly intervalMs: number

  constructor(ctx: SourceContext) {
    super('flickr', ctx, Boolean(ctx.config.flickr.apiKey), 'Set FLICKR_API_KEY in .env.local')
    this.intervalMs = ctx.config.flickr.pollMs
  }

  protected async fetchArea(area: Area) {
    const response = await fetchJson<SearchResponse>(
      `https://api.flickr.com/services/rest/?${new URLSearchParams({
        method: 'flickr.photos.search',
        api_key: this.ctx.config.flickr.apiKey!,
        lat: String(area.center.lat),
        lon: String(area.center.lon),
        radius: String(Number(clamp(area.radiusM / 1000, 0.05, 32).toFixed(3))),
        radius_units: 'km',
        min_upload_date: String(Math.floor(this.ctx.store.windowStart() / 1000)),
        sort: 'date-posted-desc',
        extras: 'geo,date_upload,owner_name,url_m,description,tags,media',
        per_page: '250',
        format: 'json',
        nojsoncallback: '1',
      })}`,
    )
    if (response.stat !== 'ok') throw new Error(`Flickr: ${response.message}`)

    for (const photo of response.photos.photo) {
      const lat = Number(photo.latitude)
      const lon = Number(photo.longitude)
      this.addPost({
        id: `flickr:${photo.id}`,
        source: 'flickr',
        url: `https://www.flickr.com/photos/${photo.owner}/${photo.id}`,
        text: [photo.title, stripHtml(photo.description?._content ?? '')].filter(Boolean).join('\n'),
        createdAt: Number(photo.dateupload) * 1000,
        author: { id: photo.owner, name: photo.ownername || photo.owner },
        media: photo.url_m ? [{ type: photo.media === 'video' ? 'video' : 'image', url: photo.url_m }] : [],
        // Flickr accuracy runs 1 (world) to 16 (street).
        geo: lat || lon ? { lat, lon, precision: Number(photo.accuracy) >= 14 ? 'exact' : 'place' } : undefined,
        tags: photo.tags ? photo.tags.split(' ').filter(Boolean) : [],
      })
    }
  }
}
