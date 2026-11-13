const TIME_URL = 'https://gettimeapi.dev/v1/time?timezone=UTC'
const SYNC_INTERVAL_MS = 5 * 60 * 1000

type TimeSource = 'pc' | 'network'

/** Keeps the city clock tied to the device clock or a requested internet time. */
export class TimeManager {
  private readonly root = document.createElement('div')
  private readonly toggle = document.createElement('button')
  private readonly panel = document.createElement('section')
  private readonly clock = document.createElement('time')
  private readonly date = document.createElement('p')
  private readonly zone = document.createElement('p')
  private readonly status = document.createElement('p')
  private readonly pcButton = document.createElement('button')
  private readonly networkButton = document.createElement('button')
  private readonly refreshButton = document.createElement('button')
  private readonly timer: number
  private source: TimeSource = 'pc'
  private networkEpoch = 0
  private networkAnchor = 0
  private lastSync = 0
  private syncing = false
  private request: AbortController | null = null

  constructor(topbar: HTMLElement) {
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
    intro.textContent = 'Show your PC time, or request the current time from the internet.'
    this.clock.className = 'nj-time-clock'
    this.clock.setAttribute('aria-label', 'Current time')
    this.date.className = 'nj-time-date'
    this.zone.className = 'nj-time-zone'

    const sources = document.createElement('div')
    sources.className = 'nj-time-sources'
    sources.setAttribute('role', 'group')
    sources.setAttribute('aria-label', 'Time source')
    this.pcButton.type = 'button'
    this.pcButton.textContent = 'PC time'
    this.pcButton.addEventListener('click', () => this.usePc())
    this.networkButton.type = 'button'
    this.networkButton.textContent = 'Internet time'
    this.networkButton.addEventListener('click', () => void this.syncNetwork())
    sources.append(this.pcButton, this.networkButton)

    this.refreshButton.type = 'button'
    this.refreshButton.className = 'nj-time-refresh'
    this.refreshButton.textContent = 'Sync again'
    this.refreshButton.addEventListener('click', () => void this.syncNetwork())
    this.status.className = 'nj-time-status'
    this.status.setAttribute('role', 'status')
    this.status.textContent = 'Reading time from this PC.'
    this.panel.append(heading, intro, this.clock, this.date, this.zone, sources, this.refreshButton, this.status)
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
    this.status.textContent = 'Reading time from this PC.'
    this.render()
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
    } catch {
      if (this.request !== request) return
      this.status.textContent = this.source === 'network'
        ? 'Could not refresh. Showing last synced time; try again.'
        : 'Internet unavailable. Showing PC time; try again.'
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
    const epoch = this.source === 'pc' ? Date.now() : this.networkEpoch + performance.now() - this.networkAnchor
    const now = new Date(epoch)
    const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now)
    this.toggle.textContent = time
    this.toggle.dataset.source = this.source
    this.toggle.title = `Time Manager · ${this.source === 'pc' ? 'PC time' : 'Internet time'}`
    this.clock.textContent = time
    this.clock.dateTime = now.toISOString()
    this.date.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(now)
    this.zone.textContent = `Your PC time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time'}`
    this.pcButton.setAttribute('aria-pressed', String(this.source === 'pc'))
    this.networkButton.setAttribute('aria-pressed', String(this.source === 'network'))
    this.refreshButton.hidden = this.source !== 'network'
  }
}
