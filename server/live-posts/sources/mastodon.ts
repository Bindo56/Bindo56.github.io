import { fetchJson, stripHtml } from '../http'
import type { PostMedia } from '../types'
import { IntervalSource, type SourceContext } from './base'

type Status = {
  id: string
  url: string | null
  uri: string
  created_at: string
  content: string
  spoiler_text: string
  account: { id: string; acct: string; display_name: string; avatar: string }
  media_attachments: { type: string; url: string | null; preview_url: string | null }[]
  tags: { name: string }[]
  replies_count: number
  reblogs_count: number
  favourites_count: number
}

const MAX_BACKFILL_PAGES = 5

/** Hashtag timelines (#nyc, #brooklyn, …) from a Mastodon server; public, no key needed. */
export class MastodonSource extends IntervalSource {
  protected readonly intervalMs: number
  private newestId: string | undefined

  constructor(ctx: SourceContext) {
    const { server, tags } = ctx.config.mastodon
    super('mastodon', ctx, server !== 'off' && tags.length > 0, 'Set MASTODON_SERVER and MASTODON_TAGS')
    this.intervalMs = ctx.config.mastodon.pollMs
  }

  protected async fetchLatest() {
    const { server, tags } = this.ctx.config.mastodon
    const params = new URLSearchParams({ limit: '40' })
    for (const tag of tags.slice(1)) params.append('any[]', tag)
    const base = `https://${server}/api/v1/timelines/tag/${encodeURIComponent(tags[0])}`
    const windowStart = this.ctx.store.windowStart()

    if (this.newestId) {
      params.set('since_id', this.newestId)
      this.ingest(await fetchJson<Status[]>(`${base}?${params}`))
      return
    }
    // First run: page back until the window start so the last hour is filled in.
    for (let page = 0; page < MAX_BACKFILL_PAGES; page += 1) {
      const statuses = await fetchJson<Status[]>(`${base}?${params}`)
      this.ingest(statuses)
      const oldest = statuses.at(-1)
      if (!oldest || Date.parse(oldest.created_at) < windowStart) break
      params.set('max_id', oldest.id)
    }
  }

  private ingest(statuses: Status[]) {
    const { server } = this.ctx.config.mastodon
    for (const status of statuses) {
      if (!this.newestId || BigInt(status.id) > BigInt(this.newestId)) this.newestId = status.id
      const text = [status.spoiler_text, stripHtml(status.content)].filter(Boolean).join('\n')
      this.addPost({
        id: `mastodon:${status.uri}`,
        source: 'mastodon',
        url: status.url ?? status.uri,
        text,
        createdAt: Date.parse(status.created_at),
        author: {
          id: `${server}:${status.account.id}`,
          name: status.account.display_name || status.account.acct,
          handle: status.account.acct,
          avatar: status.account.avatar,
        },
        media: status.media_attachments
          .filter((attachment) => attachment.url)
          .map((attachment): PostMedia => ({
            type: attachment.type === 'image' ? 'image' : 'video',
            url: attachment.url!,
            preview: attachment.preview_url ?? undefined,
          })),
        tags: status.tags.map((tag) => tag.name),
        stats: { likes: status.favourites_count, replies: status.replies_count, reposts: status.reblogs_count },
      })
    }
  }
}
