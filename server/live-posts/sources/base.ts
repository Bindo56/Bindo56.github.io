import type { LivePostsConfig } from '../config'
import { errorMessage } from '../http'
import type { PostStore } from '../store'
import type { Area, LivePost, SourceId, SourceState, SourceStatus } from '../types'

export type SourceContext = {
  config: LivePostsConfig
  store: PostStore
  /** True when the text mentions any keyword of any watched area. */
  matchesWatched(text: string): boolean
  log(message: string): void
}

export abstract class SourceBase {
  readonly id: SourceId
  protected readonly ctx: SourceContext
  private readonly info: SourceStatus
  private lastLoggedError = ''

  constructor(id: SourceId, ctx: SourceContext, enabled: boolean, disabledNote: string) {
    this.id = id
    this.ctx = ctx
    this.info = { enabled, state: enabled ? 'idle' : 'off', note: enabled ? undefined : disabledNote, added: 0 }
  }

  get enabled() {
    return this.info.enabled
  }

  status(): SourceStatus {
    return { ...this.info }
  }

  protected setState(state: SourceState) {
    this.info.state = state
  }

  protected setNote(note: string | undefined) {
    this.info.note = note
  }

  protected succeed(state: SourceState = 'ok') {
    this.info.state = state
    this.info.lastSuccessAt = Date.now()
    this.info.lastError = undefined
    this.lastLoggedError = ''
  }

  protected fail(error: unknown) {
    const message = errorMessage(error)
    this.info.state = 'error'
    this.info.lastError = message
    this.info.lastErrorAt = Date.now()
    if (message !== this.lastLoggedError) this.ctx.log(`${this.id}: ${message}`)
    this.lastLoggedError = message
  }

  protected addPost(post: LivePost) {
    const added = this.ctx.store.add(post)
    if (added) this.info.added += 1
    return added
  }
}

/** Sources that run on their own (a stream or a fixed poll), independent of which areas are watched. */
export abstract class StreamSource extends SourceBase {
  abstract start(): void
  abstract stop(): void
}

/** Polls on an interval for sources that are not area-specific (hashtag feeds). */
export abstract class IntervalSource extends StreamSource {
  protected abstract readonly intervalMs: number
  private timer: ReturnType<typeof setInterval> | undefined
  private running = false

  start() {
    if (!this.enabled || this.timer) return
    void this.run()
    this.timer = setInterval(() => void this.run(), this.intervalMs)
  }

  stop() {
    clearInterval(this.timer)
    this.timer = undefined
  }

  private async run() {
    if (this.running) return
    this.running = true
    try {
      await this.fetchLatest()
      this.succeed()
    } catch (error) {
      this.fail(error)
    } finally {
      this.running = false
    }
  }

  protected abstract fetchLatest(): Promise<void>
}

/** Sources that search by location, polled once per watched area per interval. */
export abstract class AreaSource extends SourceBase {
  abstract readonly intervalMs: number

  async poll(area: Area) {
    if (!this.enabled) return
    try {
      await this.fetchArea(area)
      this.succeed()
    } catch (error) {
      this.fail(error)
    }
  }

  protected abstract fetchArea(area: Area): Promise<void>
}
