import * as THREE from 'three'
import { loadProofCharacter, type ProofCharacter } from './npcProofCharacter'
import { PublicProofScenario } from './npcProofPublic'
import { m } from './skyline/kit'
import './npcProof.css'

type Point = { x: number; z: number }
type Customer = { id?: number | string; x: number; z: number; heading?: number; animation?: string }

export type NpcProofState = {
  worldTimeMs: number
  shift: number
  shiftElapsedMs: number
  speed: number
  paused: boolean
  worker: {
    id: number
    name: string
    x: number
    z: number
    heading: number
    phase: string
    taskLabel: string
    animation: string
    home: Point
    work: Point
  }
  cart: {
    x: number
    z: number
    heading?: number
    stock: number
    queue: number
    served: number
    open: boolean
    workerSpot?: Point
    queueSpots?: Point[]
  }
  customers?: Customer[]
  route?: { outbound?: Point[]; returning?: Point[] }
}

type FocusCallback = (x: number, z: number, height: number) => void

function scenarioTime(shift: number, elapsedMs: number) {
  const seconds = Math.floor(elapsedMs / 1000)
  return `SHIFT ${shift} · ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function addBox(group: THREE.Group, size: [number, number, number], at: [number, number, number], color: string) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ color, fog: true }))
  mesh.position.set(...at)
  group.add(mesh)
  return mesh
}

function makeCart() {
  const group = new THREE.Group()
  group.name = 'First proof street food cart'
  // This prop was authored in metre-sized dimensions; city coordinates are 3 m blocks.
  // Its smaller canopy is about 2.3 m high, with a counter near 1 m.
  group.scale.setScalar(m(.65))
  addBox(group, [3.2, .16, 1.85], [0, .52, 0], '#515861')
  addBox(group, [3.05, .8, 1.7], [0, 1, 0], '#d6d0ba')
  addBox(group, [3.3, .12, 2], [0, 1.47, 0], '#28363b')
  addBox(group, [2.8, .16, .3], [0, 1.63, 1.02], '#f2c879')
  for (const x of [-1.13, 1.13]) for (const z of [-.7, .7]) {
    addBox(group, [.14, 1.92, .14], [x, 2.45, z], '#e9dbbe')
    addBox(group, [.4, .4, .22], [x, .42, z], '#20272a')
  }
  addBox(group, [3.7, .17, 2.22], [0, 3.47, 0], '#c53339')
  for (const x of [-1.36, -.45, .45, 1.36]) addBox(group, [.47, .18, 2.25], [x, 3.59, 0], '#f6e9cd')
  addBox(group, [2.38, .42, .12], [0, 2.45, 1.12], '#15393a')
  addBox(group, [2.12, .1, .17], [0, 2.46, 1.24], '#f1bf73')
  for (const x of [-.8, 0, .8]) addBox(group, [.38, .14, .34], [x, 1.62, .15], '#c87933')
  // Jose sits here during the lunch break. The position matches the simulation's break spot.
  addBox(group, [.8, .12, .8], [1.8, .57, -2.7], '#855739')
  for (const x of [1.52, 2.08]) for (const z of [-2.98, -2.42])
    addBox(group, [.1, .55, .1], [x, .27, z], '#4e3b31')

  const stock: THREE.Mesh[] = []
  for (let i = 0; i < 8; i++) {
    const box = addBox(group, [.3, .2, .3], [-1.17 + (i % 4) * .41, 1.72, -.48 + Math.floor(i / 4) * .4],
      i % 2 ? '#e6b258' : '#d9873a')
    stock.push(box)
  }
  const queueMarks = new THREE.Group()
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(.3, .39, 16),
      new THREE.MeshBasicMaterial({ color: '#f2c879', side: THREE.DoubleSide, depthWrite: false, transparent: true, opacity: .65 }))
    ring.rotation.x = -Math.PI / 2
    ring.position.set(.7, .15, 4 + i * 3)
    queueMarks.add(ring)
  }
  group.add(queueMarks)
  return { group, stock, queueMarks }
}

export class NpcProof {
  readonly group = new THREE.Group()
  private readonly panel: HTMLElement
  private readonly marker: HTMLButtonElement
  private readonly cart = makeCart()
  private worker: ProofCharacter | null = null
  private customers: ProofCharacter[] = []
  private state: NpcProofState | null = null
  private pending: Promise<void> | null = null
  private pollTimer = 0
  private inFlight = false
  private following = false
  private active = false
  private zoneId = 'city'
  private workerPlaced = false
  private currentAction = ''
  private statusMessage = ''
  private readonly publicScenario = import.meta.env.DEV ? null : new PublicProofScenario()

  constructor(
    private readonly scene: THREE.Scene,
    private readonly app: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly onFocus: FocusCallback,
  ) {
    this.group.name = 'NPC first proof'
    this.group.add(this.cart.group)
    this.scene.add(this.group)

    this.panel = document.createElement('aside')
    this.panel.className = 'nj-proof-panel'
    this.panel.hidden = true
    this.panel.setAttribute('aria-label', 'NPC behavior first proof')
    this.panel.innerHTML = `
      <button type="button" class="nj-proof-close" aria-label="Close NPC proof">×</button>
      <span class="nj-proof-kicker">FIRST PROOF · ${this.publicScenario ? 'BROWSER PREVIEW' : 'PERSISTENT NPC'}</span>
      <h2>One worker, one living shift</h2>
      <p class="nj-proof-description">Follow a worker from home to a street cart. The job and cart continue while the camera is away.</p>
      <div class="nj-proof-status" role="status">Preparing scenario…</div>
      <div class="nj-proof-grid">
        <div><span>SCENARIO CLOCK</span><strong data-proof="time">—</strong></div>
        <div><span>WORKER</span><strong data-proof="name">—</strong></div>
        <div><span>CURRENT TASK</span><strong data-proof="task">—</strong></div>
        <div><span>CART</span><strong data-proof="cart">—</strong></div>
      </div>
      <div class="nj-proof-controls">
        <button type="button" data-proof-action="follow">FOLLOW WORKER</button>
        <button type="button" data-proof-action="cart">VIEW CART</button>
        <button type="button" data-proof-action="pause">PAUSE</button>
        <button type="button" data-proof-action="reset">RESTART SHIFT</button>
      </div>
      <label class="nj-proof-speed">SCENARIO SPEED
        <select aria-label="Scenario speed">
          <option value="6">6× · 4 minute shift</option>
          <option value="24">24× · 1 minute shift</option>
          <option value="48">48× · 30 second shift</option>
          <option value="96">96× · 15 second shift</option>
        </select>
      </label>
      <small>${this.publicScenario
        ? 'This 25-minute sample shift repeats. Its clock is saved in this browser.'
        : 'This 25-minute sample shift repeats. Its clock and state are saved in local SQLite.'}</small>
    `
    this.app.append(this.panel)
    this.panel.querySelector<HTMLButtonElement>('.nj-proof-close')!.addEventListener('click', () => this.close())
    this.panel.querySelector<HTMLButtonElement>('[data-proof-action="follow"]')!.addEventListener('click', () => this.follow())
    this.panel.querySelector<HTMLButtonElement>('[data-proof-action="cart"]')!.addEventListener('click', () => this.viewCart())
    this.panel.querySelector<HTMLButtonElement>('[data-proof-action="pause"]')!.addEventListener('click', () => {
      void this.control(this.state?.paused ? 'resume' : 'pause')
    })
    this.panel.querySelector<HTMLButtonElement>('[data-proof-action="reset"]')!.addEventListener('click', () => {
      void this.control('reset')
    })
    this.panel.querySelector<HTMLSelectElement>('select')!.addEventListener('change', (event) => {
      void this.control('speed', Number((event.target as HTMLSelectElement).value))
    })

    this.marker = document.createElement('button')
    this.marker.type = 'button'
    this.marker.className = 'nj-proof-marker'
    this.marker.hidden = true
    this.marker.textContent = '● WORKER'
    this.marker.setAttribute('aria-label', 'Select the first proof worker')
    this.marker.addEventListener('click', () => this.follow())
    this.app.append(this.marker)
    this.group.visible = false
  }

  get hasState() { return this.state !== null }
  get isFollowing() { return this.following && this.active }

  get followPoint(): Point | null {
    if (!this.worker || !this.state || !this.isFollowing) return null
    return { x: this.worker.group.position.x, z: this.worker.group.position.z }
  }

  setZone(id: string) {
    this.zoneId = id
    if (id !== 'city') this.following = false
  }

  stopFollowing() {
    if (!this.following) return
    this.following = false
    this.updatePanel()
  }

  async open() {
    this.active = true
    this.panel.hidden = false
    this.app.classList.add('nj-proof-active')
    try {
      await this.start()
      this.follow()
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : 'Could not start the NPC proof.'
      this.updatePanel()
    }
  }

  close() {
    this.active = false
    this.following = false
    this.panel.hidden = true
    this.app.classList.remove('nj-proof-active')
  }

  private async start() {
    if (this.pending) return this.pending
    this.pending = (async () => {
      const characters = await Promise.all([0, 1, 2, 3, 4].map((variant) => loadProofCharacter(variant)))
      this.worker = characters[0]
      this.customers = characters.slice(1)
      for (const person of characters) this.group.add(person.group)
      await this.refresh()
      this.pollTimer = window.setInterval(() => { void this.refresh() }, 250)
    })()
    try { await this.pending } catch (error) { this.pending = null; throw error }
  }

  private async refresh() {
    if (this.inFlight) return
    this.inFlight = true
    try {
      let next: NpcProofState
      if (this.publicScenario) next = this.publicScenario.state()
      else {
        const response = await fetch('/api/npc-proof/state', { cache: 'no-store' })
        if (!response.ok) throw new Error(`NPC scenario API returned ${response.status}. Run the local Vite server.`)
        next = await response.json() as NpcProofState
      }
      if (!Number.isFinite(next.worker?.x) || !Number.isFinite(next.worker?.z) || !next.cart) {
        throw new Error('NPC scenario returned an invalid position.')
      }
      this.state = next
      this.statusMessage = ''
      this.cart.group.position.set(next.cart.x, -.03, next.cart.z)
      this.cart.group.rotation.y = next.cart.heading ?? 0
      this.cart.queueMarks.visible = next.cart.open
      const visibleStock = Math.min(this.cart.stock.length, Math.max(0, Math.ceil(next.cart.stock / 2)))
      this.cart.stock.forEach((box, index) => { box.visible = index < visibleStock })
      if (this.worker && !this.workerPlaced) {
        this.worker.group.position.set(next.worker.x, .02, next.worker.z)
        this.workerPlaced = true
      }
      this.updatePanel()
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : 'NPC scenario is unavailable.'
      this.updatePanel()
    } finally {
      this.inFlight = false
    }
  }

  private async control(action: 'pause' | 'resume' | 'reset' | 'speed', speed?: number) {
    try {
      if (this.publicScenario) this.publicScenario.control(action, speed)
      else {
        const response = await fetch('/api/npc-proof/control', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...(speed === undefined ? {} : { speed }) }),
        })
        if (!response.ok) throw new Error(`Could not ${action} the scenario (${response.status}).`)
      }
      if (action === 'reset') this.workerPlaced = false
      await this.refresh()
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : 'Scenario control failed.'
      this.updatePanel()
    }
  }

  private updatePanel() {
    const status = this.panel.querySelector<HTMLElement>('.nj-proof-status')!
    status.textContent = this.statusMessage || (this.state?.paused ? 'Scenario paused' : 'The shift continues while the camera is away')
    status.classList.toggle('error', !!this.statusMessage)
    if (!this.state) return
    const { worker, cart, shift, shiftElapsedMs, paused, speed } = this.state
    this.panel.querySelector<HTMLElement>('[data-proof="time"]')!.textContent = scenarioTime(shift, shiftElapsedMs)
    this.panel.querySelector<HTMLElement>('[data-proof="name"]')!.textContent = `${worker.name} · #${worker.id}`
    this.panel.querySelector<HTMLElement>('[data-proof="task"]')!.textContent = worker.taskLabel || worker.phase
    this.panel.querySelector<HTMLElement>('[data-proof="cart"]')!.textContent = `${cart.open ? 'OPEN' : 'CLOSED'} · ${cart.stock} STOCK · ${cart.queue} WAITING · ${cart.served} SERVED`
    this.panel.querySelector<HTMLButtonElement>('[data-proof-action="pause"]')!.textContent = paused ? 'RESUME' : 'PAUSE'
    this.panel.querySelector<HTMLButtonElement>('[data-proof-action="follow"]')!.textContent = this.following ? 'FOLLOWING WORKER' : 'FOLLOW WORKER'
    const speedPicker = this.panel.querySelector<HTMLSelectElement>('select')!
    if ([6, 24, 48, 96].includes(speed)) speedPicker.value = String(speed)
    this.marker.textContent = `● ${worker.name.toUpperCase()}`
  }

  private follow() {
    if (!this.state || this.zoneId !== 'city') return
    this.active = true
    this.panel.hidden = false
    this.app.classList.add('nj-proof-active')
    this.following = true
    this.onFocus(this.state.worker.x, this.state.worker.z, 7)
    this.updatePanel()
  }

  private viewCart() {
    if (!this.state || this.zoneId !== 'city') return
    this.following = false
    this.onFocus(this.state.cart.x, this.state.cart.z, 7)
    this.updatePanel()
  }

  update(dt: number, viewHeight: number, focus: THREE.Vector3): boolean {
    if (!this.state || !this.worker) return false
    const { worker, cart } = this.state
    const near = Math.hypot(focus.x - cart.x, focus.z - cart.z) < Math.max(120, viewHeight * .95)
      || Math.hypot(focus.x - worker.x, focus.z - worker.z) < Math.max(120, viewHeight * .95)
    const visible = this.zoneId === 'city' && near && viewHeight < 450
    const visibilityChanged = this.group.visible !== visible
    if (visibilityChanged) this.group.visible = visible
    if (!visible) { this.marker.hidden = true; return visibilityChanged }

    const destination = new THREE.Vector3(worker.x, .02, worker.z)
    if (this.worker.group.position.distanceToSquared(destination) > 10000) this.worker.group.position.copy(destination)
    else this.worker.group.position.lerp(destination, 1 - Math.exp(-12 * dt))
    this.worker.group.rotation.y = worker.heading || 0
    const action = worker.animation || 'idle'
    if (action !== this.currentAction) { this.worker.setAction(action); this.currentAction = action }
    this.worker.update(dt)

    const queue = Math.max(0, Math.min(this.customers.length, this.state.customers?.length ?? 0))
    for (let i = 0; i < this.customers.length; i++) {
      const person = this.customers[i]
      person.group.visible = i < queue
      if (!person.group.visible) continue
      const known = this.state.customers?.[i]
      const fallback = cart.queueSpots?.[i]
      person.group.position.set(known?.x ?? fallback?.x ?? cart.x - .15,
        .02, known?.z ?? fallback?.z ?? cart.z - .85 - i * .65)
      person.group.rotation.y = known?.heading ?? (cart.heading ?? 0) + Math.PI
      person.setAction(known?.animation || 'idle')
      person.update(dt)
    }
    this.positionMarker(viewHeight)
    return true
  }

  private positionMarker(viewHeight: number) {
    if (!this.worker || viewHeight > 110) { this.marker.hidden = true; return }
    const world = this.worker.group.position.clone().add(new THREE.Vector3(0, m(2), 0))
    world.project(this.camera)
    const screenX = (world.x * .5 + .5) * this.app.clientWidth
    const screenY = (-world.y * .5 + .5) * this.app.clientHeight
    const inView = world.z > -1 && world.z < 1 && screenX > 10 && screenX < this.app.clientWidth - 10
      && screenY > 66 && screenY < this.app.clientHeight - 60
    this.marker.hidden = !inView
    if (inView) {
      this.marker.style.left = `${screenX}px`
      this.marker.style.top = `${screenY}px`
    }
  }

  dispose() {
    if (this.pollTimer) window.clearInterval(this.pollTimer)
    this.worker?.dispose()
    this.customers.forEach((person) => person.dispose())
    this.group.remove(this.cart.group)
    this.cart.group.traverse((item) => {
      if (item instanceof THREE.Mesh) {
        item.geometry.dispose()
        if (Array.isArray(item.material)) item.material.forEach((material) => material.dispose())
        else item.material.dispose()
      }
    })
    this.scene.remove(this.group)
    this.panel.remove()
    this.marker.remove()
  }
}
