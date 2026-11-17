import type { NearbyNpc, PopulationRequest, PopulationResponse, InspectedNpc } from './npcPopulationProtocol'

const number = new Intl.NumberFormat('en-US')

function clock(minute: number): string {
  const hour = Math.floor(minute / 60)
  return `${(hour % 12) || 12}:${String(minute % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

export class NpcPopulation {
  private worker: Worker | null = null
  private readonly button: HTMLButtonElement
  private readonly panel: HTMLElement
  private readonly overlay: HTMLElement
  private readonly status: HTMLElement
  private readonly progress: HTMLProgressElement
  private readonly count: HTMLElement
  private readonly list: HTMLElement
  private readonly detail: HTMLElement
  private readonly retry: HTMLButtonElement
  private ready = false
  private loaded = 0
  private lastQuery = 0
  private lastX = NaN
  private lastZ = NaN
  private requestId = 0
  private inspectRequestId = 0
  private selectedId = 0
  private followingId = 0
  private wasStreet = false
  private lastPeople: NearbyNpc[] = []
  private disposed = false

  constructor(root: HTMLElement, private readonly baseUrl: string,
    private readonly onNearby: (people: NearbyNpc[]) => void,
    private readonly onFocus: (npcId: number) => void,
    private readonly timeMs: () => number) {
    const controls = root.querySelector('.nj-controls')!
    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'nj-population-button'
    this.button.textContent = 'NPCs 0 / 100K'
    this.button.setAttribute('aria-label', 'Open 100,000 NPC population and tasks')
    this.button.setAttribute('aria-expanded', 'false')
    controls.insertBefore(this.button, root.querySelector('#nj-proof'))

    this.panel = document.createElement('aside')
    this.panel.className = 'nj-population-panel'
    this.panel.hidden = true
    this.panel.setAttribute('aria-label', 'New York Sim NPC population')
    this.panel.innerHTML = `<div class="nj-population-heading"><div><span class="nj-eyebrow">NEW YORK SIM · ON THIS DEVICE</span><h2>100,000 NPCs</h2></div><button class="nj-population-close" type="button" aria-label="Close NPC panel">×</button></div>
      <p class="nj-population-status" role="status">Preparing the population…</p>
      <progress class="nj-population-progress" value="0" max="100000" aria-label="NPCs loaded"></progress>
      <p class="nj-population-count">0 of 100,000 profiles loaded</p>
      <button class="nj-population-retry" type="button" hidden>RETRY LOADING</button>
      <h3>Near the camera</h3><p class="nj-population-note">Select a person to zoom to their location. People inside homes, offices, schools, shops, and cafes stay in their buildings. Walking characters use sidewalks and entrances. Tasks follow this browser’s city clock.</p>
      <div class="nj-population-list" aria-live="polite">Loading nearby NPCs…</div>
      <div class="nj-population-detail" hidden></div>`
    root.querySelector('.nj-ui')!.append(this.panel)
    this.status = this.panel.querySelector('.nj-population-status')!
    this.progress = this.panel.querySelector('.nj-population-progress')!
    this.count = this.panel.querySelector('.nj-population-count')!
    this.list = this.panel.querySelector('.nj-population-list')!
    this.detail = this.panel.querySelector('.nj-population-detail')!
    this.retry = this.panel.querySelector('.nj-population-retry')!

    this.overlay = document.createElement('div')
    this.overlay.className = 'nj-population-loading'
    this.overlay.hidden = true
    this.overlay.setAttribute('role', 'status')
    this.overlay.innerHTML = `<div class="nj-population-loading-card"><span class="nj-eyebrow">NEW YORK SIM</span><h2>Waking up the city</h2><p>Loading people and places around you…</p><progress value="0" max="100000" aria-label="NPC population loading"></progress><small>0 of 100,000 NPCs ready</small></div>`
    root.querySelector('.nj-ui')!.append(this.overlay)

    this.button.addEventListener('click', () => {
      this.panel.hidden = !this.panel.hidden
      this.button.setAttribute('aria-expanded', String(!this.panel.hidden))
      if (!this.panel.hidden) this.refresh(this.lastX, this.lastZ, true)
    })
    this.panel.querySelector('.nj-population-close')!.addEventListener('click', () => {
      this.panel.hidden = true
      this.button.setAttribute('aria-expanded', 'false')
      this.button.focus()
    })
    this.retry.addEventListener('click', () => this.start(this.lastX, this.lastZ))
  }

  start(x: number, z: number): void {
    if (this.disposed) return
    this.worker?.terminate()
    this.ready = false
    this.loaded = 0
    this.lastX = x
    this.lastZ = z
    this.lastQuery = 0
    this.retry.hidden = true
    this.status.textContent = 'Loading the nearby population…'
    this.overlay.hidden = false
    this.overlay.querySelector('p')!.textContent = 'Loading people and places around you…'
    try {
      this.worker = new Worker(new URL('./npcPopulation.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (event: MessageEvent<PopulationResponse>) => this.receive(event.data)
      this.worker.onerror = () => this.fail('The population worker could not start.')
      this.post({ type: 'init', baseUrl: this.baseUrl, x, z })
    } catch {
      this.fail('This browser could not start the population worker.')
    }
  }

  private post(message: PopulationRequest): void { this.worker?.postMessage(message) }

  private receive(message: PopulationResponse): void {
    if (this.disposed) return
    if (message.type === 'progress' || message.type === 'ready' || message.type === 'complete') {
      this.loaded = message.loaded
      this.progress.value = message.loaded
      this.overlay.querySelector('progress')!.value = message.loaded
      this.count.textContent = `${number.format(message.loaded)} of ${number.format(message.total)} profiles loaded`
      this.overlay.querySelector('small')!.textContent = `${number.format(message.loaded)} of 100,000 NPCs ready`
      this.button.textContent = `NPCs ${message.loaded === 100000 ? '100K' : `${Math.round(message.loaded / 1000)}K / 100K`}`
      if (message.type === 'progress') {
        this.status.textContent = `${message.shardsLoaded} of ${message.shardsTotal} city areas loaded. ${message.cached ? 'Saved on this device.' : 'Loading from the site.'}`
      }
    }
    if (message.type === 'ready') {
      this.ready = true
      this.overlay.hidden = true
      this.status.textContent = 'Nearby NPCs ready. Loading the rest of the city in the background.'
      this.refresh(this.lastX, this.lastZ, true)
    } else if (message.type === 'complete') {
      this.status.textContent = `${number.format(message.loaded)} NPC profiles and ${number.format(message.relationships)} relationships ready on this device.`
    } else if (message.type === 'error') {
      this.fail(message.message)
    } else if (message.type === 'nearby' && message.requestId === this.requestId) {
      this.showNearby(message.people)
    } else if (message.type === 'inspect' && message.requestId === this.inspectRequestId) {
      if (message.result) this.showDetail(message.result)
      else this.detail.textContent = message.error ?? 'This NPC is not available yet.'
    }
  }

  private fail(message: string): void {
    this.overlay.hidden = true
    this.status.textContent = `Population loading paused: ${message}`
    this.retry.hidden = false
    this.button.textContent = this.ready ? `NPCs ${Math.round(this.loaded / 1000)}K / 100K` : 'NPCs · RETRY'
    if (!this.ready) this.list.textContent = 'The city model is available. Retry to load NPC tasks.'
  }

  update(x: number, z: number, viewHeight: number, now: number): void {
    this.lastX = x
    this.lastZ = z
    const street = viewHeight < 200
    if (this.ready && (street || !this.panel.hidden) && (street && !this.wasStreet || now - this.lastQuery > 5000))
      this.refresh(x, z, street && !this.wasStreet, viewHeight)
    this.wasStreet = street
  }

  private refresh(x: number, z: number, force: boolean, viewHeight = 260): void {
    if (!this.ready || !Number.isFinite(x) || !Number.isFinite(z)) return
    const now = performance.now()
    if (!force && now - this.lastQuery < 5000) return
    this.lastQuery = now
    this.requestId++
    this.post({ type: 'nearby', requestId: this.requestId, x, z,
      radius: Math.max(110, Math.min(420, viewHeight * 1.5)), limit: 12, timeMs: this.timeMs(),
      followId: this.followingId || undefined })
    if (this.selectedId) this.inspect(this.selectedId)
  }

  private inspect(npcId: number): void {
    this.post({ type: 'inspect', requestId: ++this.inspectRequestId, npcId, timeMs: this.timeMs() })
  }

  focusNpc(npcId: number): void {
    this.selectedId = npcId
    this.followingId = npcId
    this.detail.hidden = false
    this.detail.textContent = 'Generating this NPC’s week…'
    this.inspect(npcId)
    this.panel.hidden = true
    this.button.setAttribute('aria-expanded', 'false')
    this.onFocus(npcId)
  }

  stopFollowing(): void { this.followingId = 0 }

  refreshNow(): void { this.refresh(this.lastX, this.lastZ, true) }

  private showNearby(people: NearbyNpc[]): void {
    this.lastPeople = people
    this.onNearby(people)
    this.list.replaceChildren()
    if (!people.length) {
      this.list.textContent = 'No assigned NPC places are near this camera position. Pan toward mapped buildings.'
      return
    }
    for (const person of people) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'nj-population-person'
      button.setAttribute('aria-label', `Zoom to ${person.name} in the city`)
      const name = document.createElement('strong')
      name.textContent = person.name
      const activity = document.createElement('span')
      const indoors = !person.movement && person.placeKind !== 'park_access' && person.placeKind !== 'station_access'
      activity.textContent = person.movement ? person.activity
        : `${person.activity}${indoors ? ' indoors' : ''} · ${person.placeLabel}`
      const role = document.createElement('small')
      role.textContent = `${person.role.toUpperCase()} · ${Math.round(person.distance)} blocks away`
      button.append(name, activity, role)
      button.addEventListener('click', () => this.focusNpc(person.npcId))
      this.list.append(button)
    }
  }

  private showDetail(person: InspectedNpc): void {
    this.detail.replaceChildren()
    this.detail.hidden = false
    const heading = document.createElement('h3')
    heading.textContent = person.name
    const summary = document.createElement('p')
    summary.textContent = `${person.role.toUpperCase()} · ${person.localDate} · ${person.movement
      ? `${person.movement.from.label} → ${person.movement.to.label}` : person.currentPlace}`
    const current = document.createElement('p')
    current.textContent = person.movement
      ? `NOW ${clock(person.movement.startMinute)}–${clock(person.movement.endMinute)} · walking to ${person.movement.to.label}`
      : `NOW ${clock(person.current.startMinute)}–${clock(person.current.endMinute)} · ${person.current.activity}`
    const next = document.createElement('p')
    next.textContent = `NEXT ${clock(person.next.startMinute)} · ${person.next.activity}`
    const daily = document.createElement('ol')
    const today = person.week.days.find((day) => day.localDate === person.localDate)
    for (const episode of today?.episodes ?? []) {
      const row = document.createElement('li')
      row.textContent = `${clock(episode.startMinute)} ${episode.activity}`
      daily.append(row)
    }
    const assignments = document.createElement('dl')
    assignments.className = 'nj-population-assignments'
    for (const [kind, place] of Object.entries(person.assignments)) {
      const term = document.createElement('dt')
      term.textContent = kind === 'work' && person.role === 'student' ? 'SCHOOL' : kind.toUpperCase()
      const description = document.createElement('dd')
      description.textContent = place ?? 'No regular assignment'
      assignments.append(term, description)
    }
    this.detail.append(heading, summary, current, next, assignments, daily)
    if (this.lastPeople.some((nearby) => nearby.npcId === person.npcId)) {
      const view = document.createElement('button')
      view.type = 'button'
      view.className = 'nj-population-view'
      view.textContent = 'VIEW NPC IN CITY'
      view.addEventListener('click', () => {
        this.focusNpc(person.npcId)
      })
      this.detail.append(view)
    }
  }

  dispose(): void {
    this.disposed = true
    this.worker?.terminate()
    this.panel.remove()
    this.overlay.remove()
    this.button.remove()
  }
}
