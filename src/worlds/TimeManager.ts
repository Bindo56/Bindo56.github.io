import { localClockAsNewYorkEpoch } from './npcClock'

const TIME_URL = 'https://gettimeapi.dev/v1/time?timezone=UTC'
const SYNC_INTERVAL_MS = 5 * 60 * 1000

type TimeSource = 'local' | 'pc' | 'network' | 'preview'

const PREVIEW_SPEED = 20

export function nextNewYorkMondayMorning(epoch: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short',
  }).formatToParts(epoch)
  const part = (name: string) => parts.find((item) => item.type === name)!.value
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(part('weekday'))
  const daysAhead = (7 - weekday) % 7
  const year = Number(part('year')), month = Number(part('month')), day = Number(part('day')) + daysAhead
  const noon = Date.UTC(year, month - 1, day, 12)
  const offsetPart = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', timeZoneName: 'shortOffset',
  }).formatToParts(noon).find((item) => item.type === 'timeZoneName')?.value ?? 'GMT-5'
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetPart)
  const offsetMinutes = match ? (match[1] === '+' ? 1 : -1) *
    (Number(match[2]) * 60 + Number(match[3] ?? 0)) : -300
  return Date.UTC(year, month - 1, day, 8, 45) - offsetMinutes * 60000
}

/** Keeps the city clock tied to the device clock or a requested internet time. */
export class TimeManager {
  private readonly root = document.createElement('div')
  private readonly toggle = document.createElement('button')
  private readonly panel = document.createElement('section')
  private readonly clock = document.createElement('time')
  private readonly date = document.createElement('p')
  private readonly zone = document.createElement('p')
  private readonly status = document.createElement('p')
  private readonly localButton = document.createElement('button')
  private readonly pcButton = document.createElement('button')
  private readonly networkButton = document.createElement('button')
  private readonly previewButton = document.createElement('button')
  private readonly refreshButton = document.createElement('button')
  private readonly timer: number
  private source: TimeSource = 'local'
  private networkEpoch = 0
  private networkAnchor = 0
  private previewEpoch = 0
  private previewAnchor = 0
  private lastSync = 0
  private syncing = false
  private request: AbortController | null = null

  constructor(topbar: HTMLElement, private readonly onTimeChange: () => void = () => {}) {
    this.root.className = 'nj-time-manager'

    this.toggle.type = 'button'
    this.toggle.className = 'nj-time-toggle'
    this.toggle.setAttribute('aria-label', 'Open Time Manager')
    this.toggle.setAttribute('aria-expanded', 'false')
    this.toggle.setAttribute('aria-controls', 'nj-time-panel')
    this.toggle.addEventListener('click', () => this.setOpen(this.panel.hidden === true))

    this.panel.id = 'nj-time-panel'
    this.panel.className = 'nj-time-panel'
    this.panel.setAttribute('aria-label', 'Time Manager')
    this.panel.hidden = true
    const heading = document.createElement('h2')
    heading.textContent = 'Time Manager'
    const intro = document.createElement('p')
    intro.className = 'nj-time-intro'
    intro.textContent = 'NPCs follow your local date and time by default. Switch to real New York time or preview a commute.'
    this.clock.className = 'nj-time-clock'
    this.clock.setAttribute('aria-label', 'Current time')
    this.date.className = 'nj-time-date'
    this.zone.className = 'nj-time-zone'

    const sources = document.createElement('div')
    sources.className = 'nj-time-sources'
    sources.setAttribute('role', 'group')
    sources.setAttribute('aria-label', 'Time source')
    this.localButton.type = 'button'
    this.localButton.textContent = 'My local time'
    this.localButton.addEventListener('click', () => this.useLocal())
    this.pcButton.type = 'button'
    this.pcButton.textContent = 'Real New York time'
    this.pcButton.addEventListener('click', () => this.usePc())
    this.networkButton.type = 'button'
    this.networkButton.textContent = 'Sync internet time'
    this.networkButton.addEventListener('click', () => void this.syncNetwork())
    sources.append(this.localButton, this.pcButton, this.networkButton)
    this.previewButton.type = 'button'
    this.previewButton.className = 'nj-time-preview'
    this.previewButton.textContent = 'Preview morning commute · 20×'
    this.previewButton.addEventListener('click', () => this.previewMorning())

    this.refreshButton.type = 'button'
    this.refreshButton.className = 'nj-time-refresh'
    this.refreshButton.textContent = 'Sync again'
    this.refreshButton.addEventListener('click', () => void this.syncNetwork())
    this.status.className = 'nj-time-status'
    this.status.setAttribute('role', 'status')
    this.status.textContent = 'NPC schedules follow your local date and time.'
    this.panel.append(heading, intro, this.clock, this.date, this.zone, sources, this.previewButton,
      this.refreshButton, this.status)
    this.root.append(this.toggle, this.panel)
    topbar.insertBefore(this.root, topbar.querySelector('.nj-status'))
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.panel.hidden) {
        event.stopPropagation()
        this.setOpen(false)
        this.toggle.focus()
      }
    })
    document.addEventListener('pointerdown', this.onOutsidePointer)
    this.render()
    this.timer = window.setInterval(() => {
      this.render()
      if (this.source === 'network' && !this.syncing && performance.now() - this.lastSync >= SYNC_INTERVAL_MS) {
        void this.syncNetwork()
      }
    }, 1000)
  }

  dispose(): void {
    window.clearInterval(this.timer)
    this.request?.abort()
    document.removeEventListener('pointerdown', this.onOutsidePointer)
    this.root.remove()
  }

  nowMs(): number {
    if (this.source === 'local') return localClockAsNewYorkEpoch(Date.now())
    if (this.source === 'preview') return Math.round(this.previewEpoch +
      (performance.now() - this.previewAnchor) * PREVIEW_SPEED)
    return this.source === 'pc' ? Date.now() :
      Math.round(this.networkEpoch + performance.now() - this.networkAnchor)
  }

  private readonly onOutsidePointer = (event: PointerEvent): void => {
    if (!this.root.contains(event.target as Node)) this.setOpen(false)
  }

  private setOpen(open: boolean): void {
    this.panel.hidden = !open
    this.toggle.setAttribute('aria-label', `${open ? 'Close' : 'Open'} Time Manager`)
    this.toggle.setAttribute('aria-expanded', String(open))
  }

  private usePc(): void {
    this.request?.abort()
    this.request = null
    this.syncing = false
    this.networkButton.disabled = false
    this.refreshButton.disabled = false
    this.source = 'pc'
    this.status.textContent = 'NPC schedules follow the current time in New York.'
    this.render()
    this.onTimeChange()
  }

  private useLocal(): void {
    this.request?.abort()
    this.request = null
    this.syncing = false
    this.networkButton.disabled = false
    this.refreshButton.disabled = false
    this.source = 'local'
    this.status.textContent = 'NPC schedules follow your local date and time.'
    this.render()
    this.onTimeChange()
  }

  private previewMorning(): void {
    this.request?.abort()
    this.request = null
    this.syncing = false
    this.networkButton.disabled = false
    this.refreshButton.disabled = false
    this.previewEpoch = nextNewYorkMondayMorning(Date.now())
    this.previewAnchor = performance.now()
    this.source = 'preview'
    this.status.textContent = 'Simulating Monday morning in New York at 20× speed on this device.'
    this.render()
    this.onTimeChange()
  }

  private async syncNetwork(): Promise<void> {
    if (this.syncing) return
    this.syncing = true
    this.networkButton.disabled = true
    this.refreshButton.disabled = true
    this.status.textContent = 'Requesting internet time…'
    const request = new AbortController()
    this.request = request
    const timeout = window.setTimeout(() => request.abort(), 8000)
    const started = performance.now()
    this.lastSync = started
    try {
      const response = await fetch(TIME_URL, { cache: 'no-store', signal: request.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data: unknown = await response.json()
      const timestamp = typeof data === 'object' && data !== null && 'timestamp' in data
        ? data.timestamp : undefined
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) throw new Error('Invalid time response')
      if (this.request !== request) return
      const received = performance.now()
      // The API reports whole seconds; compensate for half the request round trip.
      this.networkEpoch = timestamp * 1000 + (received - started) / 2
      this.networkAnchor = received
      this.lastSync = received
      this.source = 'network'
      this.status.textContent = 'Internet time synced. Updates every 5 minutes.'
      this.render()
      this.onTimeChange()
    } catch {
      if (this.request !== request) return
      this.status.textContent = this.source === 'network'
        ? 'Could not refresh. Showing last synced time; try again.'
        : 'Internet unavailable. Your selected clock is still active.'
    } finally {
      window.clearTimeout(timeout)
      if (this.request === request) {
        this.request = null
        this.syncing = false
        this.networkButton.disabled = false
        this.refreshButton.disabled = false
      }
    }
  }

  private render(): void {
    const epoch = this.source === 'local' ? Date.now() : this.nowMs()
    const now = new Date(epoch)
    const timeZone = this.source === 'local' ? undefined : 'America/New_York'
    const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone }).format(now)
    this.toggle.textContent = time
    this.toggle.dataset.source = this.source
    this.toggle.title = `Time Manager · ${this.source === 'local' ? 'Your local time' :
      this.source === 'pc' ? 'Real New York time' :
      this.source === 'network' ? 'Internet-synced New York time' : 'New York commute preview'}`
    this.clock.textContent = time
    this.clock.dateTime = now.toISOString()
    this.date.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric',
      month: 'long', day: 'numeric', timeZone }).format(now)
    this.zone.textContent = this.source === 'preview' ? 'New York time · 20× playback' :
      this.source === 'local' ? `NPC local schedule · ${Intl.DateTimeFormat().resolvedOptions().timeZone || 'Device time zone'}` :
      'Actual New York time'
    this.localButton.setAttribute('aria-pressed', String(this.source === 'local'))
    this.pcButton.setAttribute('aria-pressed', String(this.source === 'pc'))
    this.networkButton.setAttribute('aria-pressed', String(this.source === 'network'))
    this.previewButton.setAttribute('aria-pressed', String(this.source === 'preview'))
    this.refreshButton.hidden = this.source !== 'network'
  }
}
