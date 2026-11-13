import type { NpcProofState } from './npcProof'

type Point = { x: number; z: number }
type Positioned = Point & { heading: number }

const CYCLE_MS = 1_500_000
const STORAGE_KEY = 'clockwork-city-public-proof-v1'
const HOME = { x: -501.2, z: -73.8 }
const CART = {
  x: -531.2, z: -40.3, heading: Math.PI,
  workerSpot: { x: -530.55, z: -40.8 },
  queueSpots: [{ x: -531.35, z: -41.15 }, { x: -531.35, z: -41.8 }, { x: -531.35, z: -42.45 }],
}
const ROUTE = [
  HOME, { x: -515, z: -73.8 }, { x: -530.3, z: -73.6 },
  { x: -530.3, z: -50.5 }, { x: -530, z: -47 },
  { x: -530.55, z: -41.3 }, CART.workerSpot,
]
const PHASES = [
  { start: 0, end: 30_000, phase: 'home', label: 'Getting ready to leave', animation: 'idle' },
  { start: 30_000, end: 270_000, phase: 'commute_to_cart', label: 'Walking to the cart', animation: 'walk' },
  { start: 270_000, end: 360_000, phase: 'setup', label: 'Setting up the food cart', animation: 'work' },
  { start: 360_000, end: 450_000, phase: 'prepare', label: 'Preparing the first order', animation: 'work' },
  { start: 450_000, end: 570_000, phase: 'serve', label: 'Serving a customer', animation: 'talk' },
  { start: 570_000, end: 600_000, phase: 'restock', label: 'Restocking the cart', animation: 'work' },
  { start: 600_000, end: 720_000, phase: 'serve', label: 'Serving a customer', animation: 'talk' },
  { start: 720_000, end: 800_000, phase: 'break', label: 'Taking a short break', animation: 'break' },
  { start: 800_000, end: 1_040_000, phase: 'serve', label: 'Serving a customer', animation: 'talk' },
  { start: 1_040_000, end: 1_130_000, phase: 'closing', label: 'Closing the cart', animation: 'work' },
  { start: 1_130_000, end: 1_370_000, phase: 'commute_home', label: 'Walking home', animation: 'walk' },
  { start: 1_370_000, end: CYCLE_MS, phase: 'home', label: 'Resting at home', animation: 'idle' },
]
const ARRIVALS = [390_000, 510_000, 770_000, 860_000]
const SERVICE_STARTS = [450_000, 600_000, 800_000, 920_000]
const SERVICE_ENDS = [570_000, 720_000, 920_000, 1_040_000]
const DEPARTURES = [620_000, 770_000, 970_000, 1_090_000]

function heading(from: Point, to: Point): number {
  return Math.atan2(to.x - from.x, to.z - from.z)
}

function along(points: Point[], fraction: number): Positioned {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.z - points[index].z))
  let distance = Math.max(0, Math.min(1, fraction)) * lengths.reduce((sum, length) => sum + length, 0)
  for (let index = 0; index < lengths.length; index++) {
    if (distance <= lengths[index] || index === lengths.length - 1) {
      const from = points[index], to = points[index + 1]
      const progress = lengths[index] ? distance / lengths[index] : 0
      return { x: from.x + (to.x - from.x) * progress, z: from.z + (to.z - from.z) * progress, heading: heading(from, to) }
    }
    distance -= lengths[index]
  }
  return { ...points.at(-1)!, heading: 0 }
}

export function publicProofState(worldTimeMs: number, speed: number, paused: boolean): NpcProofState {
  const elapsed = worldTimeMs % CYCLE_MS
  const phase = PHASES.find((candidate) => elapsed >= candidate.start && elapsed < candidate.end)!
  const position = phase.phase === 'commute_to_cart'
    ? along(ROUTE, (elapsed - phase.start) / (phase.end - phase.start))
    : phase.phase === 'commute_home'
      ? along([...ROUTE].reverse(), (elapsed - phase.start) / (phase.end - phase.start))
      : phase.phase === 'home' ? { ...HOME, heading: Math.PI / 2 }
        : phase.phase === 'break' ? { x: -531.6, z: -39.7, heading: 0 }
          : { ...CART.workerSpot, heading: Math.PI }
  const served = SERVICE_ENDS.filter((time) => elapsed >= time).length
  const customers = ARRIVALS.flatMap((arrival, index) => {
    if (elapsed < arrival || elapsed >= DEPARTURES[index]) return []
    const entry = { x: -531.35, z: -46 }
    const spot = CART.queueSpots[index === 1 || index === 3 ? 1 : 0]
    if (elapsed < arrival + 30_000) return [{ id: index + 1, ...along([entry, spot], (elapsed - arrival) / 30_000), animation: 'walk' }]
    if (elapsed >= SERVICE_ENDS[index]) return [{ id: index + 1, ...along([spot, entry], (elapsed - SERVICE_ENDS[index]) / (DEPARTURES[index] - SERVICE_ENDS[index])), animation: 'walk' }]
    return [{ id: index + 1, ...spot, heading: Math.PI, animation: elapsed >= SERVICE_STARTS[index] ? 'talk' : 'idle' }]
  })
  return {
    worldTimeMs, shift: Math.floor(worldTimeMs / CYCLE_MS) + 1, shiftElapsedMs: elapsed, speed, paused,
    worker: { id: 37669, name: 'Jose Campbell', ...position, phase: phase.phase, taskLabel: phase.label,
      animation: phase.animation, home: HOME, work: CART.workerSpot },
    cart: { ...CART, stock: 6 - served + (elapsed >= 600_000 ? 4 : 0),
      queue: ARRIVALS.filter((arrival, index) => elapsed >= arrival + 30_000 && elapsed < SERVICE_STARTS[index]).length,
      served, open: elapsed >= 360_000 && elapsed < 1_130_000 },
    customers,
    route: { outbound: ROUTE, returning: [...ROUTE].reverse() },
  }
}

export class PublicProofScenario {
  private worldTimeMs = 360_000
  private speed = 24
  private paused = false
  private lastWallMs = Date.now()
  private lastSavedMs = 0

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved && Number.isSafeInteger(saved.worldTimeMs) && saved.worldTimeMs >= 0
        && [6, 24, 48, 96].includes(saved.speed) && typeof saved.paused === 'boolean'
        && Number.isFinite(saved.lastWallMs)) {
        this.worldTimeMs = saved.worldTimeMs
        this.speed = saved.speed
        this.paused = saved.paused
        this.lastWallMs = saved.lastWallMs
      }
    } catch { /* Browsers with disabled storage still run the preview in memory. */ }
  }

  private advance() {
    const now = Date.now()
    if (!this.paused) this.worldTimeMs += Math.max(0, now - this.lastWallMs) * this.speed
    this.lastWallMs = now
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        worldTimeMs: this.worldTimeMs, speed: this.speed, paused: this.paused, lastWallMs: this.lastWallMs,
      }))
      this.lastSavedMs = this.lastWallMs
    } catch { /* Storage is optional. */ }
  }

  state(): NpcProofState {
    this.advance()
    if (this.lastWallMs - this.lastSavedMs > 5_000) this.save()
    return publicProofState(this.worldTimeMs, this.speed, this.paused)
  }

  control(action: 'pause' | 'resume' | 'reset' | 'speed', speed?: number) {
    this.advance()
    if (action === 'pause') this.paused = true
    if (action === 'resume') this.paused = false
    if (action === 'reset') this.worldTimeMs = (Math.floor(this.worldTimeMs / CYCLE_MS) + 1) * CYCLE_MS
    if (action === 'speed' && speed !== undefined && [6, 24, 48, 96].includes(speed)) this.speed = speed
    this.save()
  }
}
