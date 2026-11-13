export type SourceId = 'bluesky' | 'mastodon' | 'youtube' | 'flickr' | 'x' | 'instagram' | 'instagram-location'

export const SOURCE_IDS: SourceId[] = ['bluesky', 'mastodon', 'youtube', 'flickr', 'x', 'instagram', 'instagram-location']

export type GeoPoint = { lat: number; lon: number }

export type PostGeo = GeoPoint & {
  /** exact = device/photo coordinates, place = a tagged place or search area */
  precision: 'exact' | 'place'
  placeName?: string
  /** west, south, east, north */
  bbox?: [number, number, number, number]
}

export type PostAuthor = { id?: string; name: string; handle?: string; avatar?: string }

export type PostMedia = { type: 'image' | 'video'; url: string; preview?: string }

export type LivePost = {
  /** `${source}:${nativeId}`, stable across fetches */
  id: string
  source: SourceId
  url: string
  text: string
  /** epoch milliseconds */
  createdAt: number
  author: PostAuthor
  media: PostMedia[]
  geo?: PostGeo
  tags?: string[]
  live?: boolean
  stats?: { likes?: number; replies?: number; reposts?: number; views?: number }
}

export type PostMatch =
  | { by: 'geo'; distanceM: number }
  | { by: 'keyword'; terms: string[] }

export type MatchedPost = LivePost & { match: PostMatch }

export type Keyword = string | RegExp

export type Area = {
  key: string
  name: string
  center: GeoPoint
  radiusM: number
  keywords: Keyword[]
  /** Instagram location IDs to read for this area (resolved from `name` when empty) */
  igLocationIds: string[]
}

export type SourceState = 'off' | 'idle' | 'connecting' | 'backfilling' | 'live' | 'ok' | 'error'

export type SourceStatus = {
  enabled: boolean
  state: SourceState
  note?: string
  /** posts this source added to the store since the server started */
  added: number
  lastSuccessAt?: number
  lastError?: string
  lastErrorAt?: number
}
