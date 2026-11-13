export type ProgressKind = 'projects' | 'career' | 'sentinels' | 'waves'

const STORAGE_KEY = 'system-zero-progress-v1'
const KINDS: readonly ProgressKind[] = ['projects', 'career', 'sentinels', 'waves']

/** Keeps discovered items available across visits when browser storage is permitted. */
export class ProgressStore {
  private readonly records: Record<ProgressKind, Set<string>> = {
    projects: new Set(),
    career: new Set(),
    sentinels: new Set(),
    waves: new Set(),
  }

  private readonly storage: Storage | null

  constructor() {
    let storage: Storage | null = null
    try {
      storage = typeof window === 'undefined' ? null : window.localStorage
    } catch {
      // Browser storage may be unavailable; progress still works for this session.
    }
    this.storage = storage

    try {
      const raw = storage?.getItem(STORAGE_KEY)
      if (!raw) return

      const saved: unknown = JSON.parse(raw)
      if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return

      const entries = saved as Record<string, unknown>
      for (const kind of KINDS) {
        const keys = entries[kind]
        if (!Array.isArray(keys)) continue
        for (const key of keys) {
          if (typeof key === 'string') this.records[kind].add(key)
        }
      }
    } catch {
      // Private browsing, blocked storage, or malformed data still allows in-memory progress.
    }
  }

  /** Returns true only when this key was not already recorded for the kind. */
  record(kind: ProgressKind, key: string): boolean {
    const entries = this.records[kind]
    if (entries.has(key)) return false

    entries.add(key)
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({
        projects: this.keys('projects'),
        career: this.keys('career'),
        sentinels: this.keys('sentinels'),
        waves: this.keys('waves'),
      }))
    } catch {
      // Storage can be denied or full; the current session still keeps its progress.
    }
    return true
  }

  has(kind: ProgressKind, key: string): boolean {
    return this.records[kind].has(key)
  }

  /** Returns a copy so callers cannot change the store's internal records. */
  keys(kind: ProgressKind): readonly string[] {
    return [...this.records[kind]]
  }

  count(kind: ProgressKind): number {
    return this.records[kind].size
  }
}
