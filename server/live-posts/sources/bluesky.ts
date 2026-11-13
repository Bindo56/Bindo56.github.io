import { fetchJson } from '../http'
import type { LivePost, PostAuthor, PostMedia } from '../types'
import { StreamSource, type SourceContext } from './base'

const JETSTREAM_HOSTS = [
  'jetstream2.us-east.bsky.network',
  'jetstream1.us-east.bsky.network',
  'jetstream1.us-west.bsky.network',
  'jetstream2.us-west.bsky.network',
]
const PROFILE_API = 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles'
const LIVE_LAG_MS = 15_000

type BlobRef = { ref?: { $link?: string } }
type ImageEmbed = { images?: { image?: BlobRef; alt?: string }[] }
type Embed = ImageEmbed & { $type?: string; media?: Embed; video?: BlobRef }
type PostRecord = { text?: string; createdAt?: string; embed?: Embed; langs?: string[] }
type JetstreamEvent = {
  did: string
  time_us: number
  kind: string
  commit?: { operation: string; collection: string; rkey: string; record?: PostRecord }
}
type Profile = { did: string; handle: string; displayName?: string; avatar?: string }

/**
 * Bluesky's public Jetstream firehose: every new post on the network, pushed over a WebSocket.
 * Posts carry no location, so only posts that mention a watched keyword are kept.
 * On start it replays from the saved cursor (or the last hour) so the window is complete.
 */
export class BlueskySource extends StreamSource {
  private socket: WebSocket | null = null
  private hostIndex = 0
  private cursorUs = 0
  private retryMs = 1000
  private phase: 'backfilling' | 'live' | null = null
  private stopped = true
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private profileTimer: ReturnType<typeof setInterval> | undefined
  private readonly pendingDids = new Set<string>()
  private readonly profiles = new Map<string, PostAuthor>()

  constructor(ctx: SourceContext) {
    super('bluesky', ctx, ctx.config.bluesky.enabled, 'Disabled with BLUESKY_ENABLED=false')
  }

  start() {
    if (!this.enabled || !this.stopped) return
    this.stopped = false
    const saved = Number(this.ctx.store.state.blueskyCursorUs) || 0
    const backfillMs = this.ctx.config.bluesky.backfillMinutes * 60_000
    const windowStartUs = this.ctx.store.windowStart() * 1000
    this.cursorUs = saved > windowStartUs ? saved : backfillMs > 0 ? Math.max(windowStartUs, (Date.now() - backfillMs) * 1000) : 0
    this.connect()
    this.profileTimer = setInterval(() => void this.resolveProfiles(), 3000)
  }

  stop() {
    this.stopped = true
    clearTimeout(this.reconnectTimer)
    clearInterval(this.profileTimer)
    const socket = this.socket
    this.socket = null
    socket?.close()
  }

  private connect() {
    const params = new URLSearchParams({ wantedCollections: 'app.bsky.feed.post' })
    // Rewind a few seconds on reconnect; duplicates are dropped by post ID.
    if (this.cursorUs) params.set('cursor', String(Math.max(0, this.cursorUs - 5_000_000)))
    const host = JETSTREAM_HOSTS[this.hostIndex % JETSTREAM_HOSTS.length]
    const socket = new WebSocket(`wss://${host}/subscribe?${params}`)
    this.socket = socket
    this.phase = null
    this.setState('connecting')
    socket.onopen = () => {
      this.retryMs = 1000
    }
    socket.onmessage = (event) => this.handle(String(event.data))
    socket.onclose = () => {
      if (this.socket !== socket || this.stopped) return
      this.socket = null
      this.fail(`Jetstream connection to ${host} closed, retrying in ${this.retryMs / 1000}s`)
      this.hostIndex += 1
      this.reconnectTimer = setTimeout(() => this.connect(), this.retryMs)
      this.retryMs = Math.min(30_000, this.retryMs * 2)
    }
  }

  private handle(raw: string) {
    let event: JetstreamEvent
    try {
      event = JSON.parse(raw) as JetstreamEvent
    } catch {
      return
    }
    if (typeof event.time_us === 'number') {
      this.cursorUs = event.time_us
      this.ctx.store.state.blueskyCursorUs = event.time_us
      const phase = Date.now() - event.time_us / 1000 < LIVE_LAG_MS ? 'live' : 'backfilling'
      if (phase !== this.phase) {
        this.phase = phase
        if (phase === 'live') {
          this.succeed('live')
          this.ctx.log('bluesky: caught up, streaming live')
        } else {
          this.setState('backfilling')
        }
      }
    }
    const commit = event.commit
    if (event.kind !== 'commit' || commit?.collection !== 'app.bsky.feed.post') return
    const id = `bluesky:${event.did}/${commit.rkey}`
    if (commit.operation === 'delete') return this.ctx.store.remove(id)
    if (commit.operation !== 'create' || !commit.record) return

    const record = commit.record
    const text = typeof record.text === 'string' ? record.text : ''
    const embed = record.embed
    const images = embed?.images ?? embed?.media?.images ?? []
    const alt = images.map((image) => image.alt ?? '').join('\n')
    if (!this.ctx.matchesWatched(`${text}\n${alt}`)) return

    const indexedAt = event.time_us / 1000
    const createdAt = Date.parse(record.createdAt ?? '')
    const post: LivePost = {
      id,
      source: 'bluesky',
      url: `https://bsky.app/profile/${event.did}/post/${commit.rkey}`,
      text,
      // Clients can backdate createdAt; trust it only when it is close to when the network saw the post.
      createdAt: Number.isFinite(createdAt) && Math.abs(createdAt - indexedAt) < 10 * 60_000 ? createdAt : indexedAt,
      author: this.profiles.get(event.did) ?? { id: event.did, name: event.did },
      media: blueskyMedia(event.did, embed),
    }
    if (this.addPost(post) && !this.profiles.has(event.did)) this.pendingDids.add(event.did)
  }

  private async resolveProfiles() {
    if (!this.pendingDids.size) return
    const dids = [...this.pendingDids].slice(0, 25)
    for (const did of dids) this.pendingDids.delete(did)
    const params = new URLSearchParams()
    for (const did of dids) params.append('actors', did)
    try {
      const { profiles } = await fetchJson<{ profiles: Profile[] }>(`${PROFILE_API}?${params}`)
      if (this.profiles.size > 5000) this.profiles.clear()
      for (const profile of profiles) {
        const author = { id: profile.did, handle: profile.handle, name: profile.displayName || profile.handle, avatar: profile.avatar }
        this.profiles.set(profile.did, author)
        this.ctx.store.updateAuthor('bluesky', profile.did, author)
      }
    } catch {
      // Names are cosmetic; posts keep the DID as the author name.
    }
  }
}

function blueskyMedia(did: string, embed: Embed | undefined): PostMedia[] {
  if (!embed) return []
  const images = embed.images ?? embed.media?.images ?? []
  const media: PostMedia[] = images
    .map((image) => image.image?.ref?.$link)
    .filter((cid): cid is string => Boolean(cid))
    .map((cid) => ({
      type: 'image',
      url: `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@jpeg`,
      preview: `https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${cid}@jpeg`,
    }))
  const videoCid = (embed.video ?? embed.media?.video)?.ref?.$link
  if (videoCid) {
    media.push({
      type: 'video',
      url: `https://video.bsky.app/watch/${encodeURIComponent(did)}/${videoCid}/playlist.m3u8`,
      preview: `https://video.bsky.app/watch/${encodeURIComponent(did)}/${videoCid}/thumbnail.jpg`,
    })
  }
  return media
}
