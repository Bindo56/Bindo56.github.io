import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { LivePost, PostAuthor, SourceId } from './types'

type Snapshot = { version: 1; savedAt: number; posts: LivePost[]; state: Record<string, unknown> }

/** Keeps only posts created inside the rolling window (default: last hour). */
export class PostStore {
  /** Small source bookkeeping (cursors, resolved IDs) saved with the snapshot. */
  state: Record<string, unknown> = {}
  private readonly posts = new Map<string, LivePost>()
  private readonly windowMs: number
  private readonly file: string | null

  constructor(windowMs: number, file: string | null) {
    this.windowMs = windowMs
    this.file = file
  }

  get size() {
    return this.posts.size
  }

  windowStart(now = Date.now()) {
    return now - this.windowMs
  }

  /** Returns true when the post is new. Posts outside the window are ignored. */
  add(post: LivePost) {
    const now = Date.now()
    if (post.createdAt < this.windowStart(now) || post.createdAt > now + 5 * 60_000) return false
    const existing = this.posts.get(post.id)
    this.posts.set(post.id, existing ? { ...existing, ...post, author: { ...existing.author, ...post.author } } : post)
    return !existing
  }

  remove(id: string) {
    this.posts.delete(id)
  }

  updateAuthor(source: SourceId, authorId: string, author: PostAuthor) {
    for (const post of this.posts.values()) {
      if (post.source === source && post.author.id === authorId) post.author = { ...post.author, ...author }
    }
  }

  prune(now = Date.now()) {
    const cutoff = this.windowStart(now)
    for (const [id, post] of this.posts) if (post.createdAt < cutoff) this.posts.delete(id)
  }

  /** Newest first. */
  list(since: number) {
    return [...this.posts.values()].filter((post) => post.createdAt >= since).sort((a, b) => b.createdAt - a.createdAt)
  }

  countBySource() {
    const counts: Partial<Record<SourceId, number>> = {}
    for (const post of this.posts.values()) counts[post.source] = (counts[post.source] ?? 0) + 1
    return counts
  }

  load() {
    if (!this.file || !existsSync(this.file)) return
    try {
      const snapshot = JSON.parse(readFileSync(this.file, 'utf8')) as Snapshot
      if (snapshot.version !== 1) return
      this.state = snapshot.state ?? {}
      for (const post of snapshot.posts ?? []) this.add(post)
    } catch {
      // A corrupt snapshot only costs the cached hour; start empty.
    }
  }

  save() {
    if (!this.file) return
    this.prune()
    const snapshot: Snapshot = { version: 1, savedAt: Date.now(), posts: [...this.posts.values()], state: this.state }
    mkdirSync(dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(snapshot))
    renameSync(temp, this.file)
  }
}
