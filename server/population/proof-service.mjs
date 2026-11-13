import { DEFAULT_DATABASE_PATH, openPopulationDatabase, transaction } from './database.mjs'

// This is one deliberately small, repeatable street-cart scene. Its route follows
// the east footpath of 7th Avenue near Times Square; it is not a general pedestrian graph.
export const PROOF_CART = Object.freeze({
  x: -531.2, z: -40.3, heading: Math.PI,
  workerSpot: { x: -530.55, z: -40.8 },
  queueSpots: [{ x: -531.35, z: -41.15 }, { x: -531.35, z: -41.8 }, { x: -531.35, z: -42.45 }],
})
export const PROOF_HOME = Object.freeze({ x: -501.2, z: -73.8 })
export const PROOF_ROUTE = Object.freeze([
  PROOF_HOME,
  { x: -515, z: -73.8 },
  { x: -530.3, z: -73.6 },
  { x: -530.3, z: -50.5 },
  { x: -530, z: -47 },
  { x: -530.55, z: -41.3 },
  PROOF_CART.workerSpot,
])

const HOME_ANCHOR = 'W266170599'
const WORK_ANCHOR = 'W163629929'
const DEFAULT_SPEED = 6
const MIN_SPEED = 0.25
const MAX_SPEED = 96
const PERSIST_EVERY_WORLD_MS = 30_000
const CYCLE_MS = 1_500_000
const MAX_DETAILED_CYCLES = 200
const META = {
  clock: 'npc_proof_clock_ms',
  speed: 'npc_proof_speed',
  paused: 'npc_proof_paused',
  workerId: 'npc_proof_worker_id',
  version: 'npc_proof_version',
}

const phases = [
  { start: 0, end: 30_000, phase: 'home', taskLabel: 'Getting ready to leave', animation: 'idle' },
  { start: 30_000, end: 270_000, phase: 'commute_to_cart', taskLabel: 'Walking to the cart', animation: 'walk' },
  { start: 270_000, end: 360_000, phase: 'setup', taskLabel: 'Setting up the food cart', animation: 'work' },
  { start: 360_000, end: 450_000, phase: 'prepare', taskLabel: 'Preparing the first order', animation: 'work' },
  { start: 450_000, end: 570_000, phase: 'serve', taskLabel: 'Serving a customer', animation: 'talk' },
  { start: 570_000, end: 600_000, phase: 'restock', taskLabel: 'Restocking the cart', animation: 'work' },
  { start: 600_000, end: 720_000, phase: 'serve', taskLabel: 'Serving a customer', animation: 'talk' },
  { start: 720_000, end: 800_000, phase: 'break', taskLabel: 'Taking a short break', animation: 'break' },
  { start: 800_000, end: 920_000, phase: 'serve', taskLabel: 'Serving a customer', animation: 'talk' },
  { start: 920_000, end: 1_040_000, phase: 'serve', taskLabel: 'Serving a customer', animation: 'talk' },
  { start: 1_040_000, end: 1_130_000, phase: 'closing', taskLabel: 'Closing the cart', animation: 'work' },
  { start: 1_130_000, end: 1_370_000, phase: 'commute_home', taskLabel: 'Walking home', animation: 'walk' },
  { start: 1_370_000, end: CYCLE_MS, phase: 'home', taskLabel: 'Resting at home', animation: 'idle' },
]

const arrivals = [390_000, 510_000, 770_000, 860_000]
const serviceStarts = [450_000, 600_000, 800_000, 920_000]
const serviceEnds = [570_000, 720_000, 920_000, 1_040_000]
const departures = [620_000, 770_000, 970_000, 1_090_000]
const events = [
  { at: 30_000, type: 'left_home' },
  { at: 270_000, type: 'arrived_at_cart' },
  { at: 360_000, type: 'cart_opened' },
  { at: 570_000, type: 'customer_served', customer: 0 },
  { at: 600_000, type: 'stock_replenished' },
  { at: 720_000, type: 'customer_served', customer: 1 },
  { at: 800_000, type: 'break_finished' },
  { at: 920_000, type: 'customer_served', customer: 2 },
  { at: 1_040_000, type: 'customer_served', customer: 3 },
  { at: 1_130_000, type: 'cart_closed' },
  { at: 1_370_000, type: 'arrived_home' },
  { at: CYCLE_MS, type: 'shift_finished' },
]

function finiteClock(value, fallback) {
  if (value === null) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Saved proof clock is invalid')
  return parsed
}

function finiteSpeed(value, fallback) {
  if (value === null) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < MIN_SPEED || parsed > MAX_SPEED) throw new Error('Saved proof speed is invalid')
  return parsed
}

function phaseAt(worldTimeMs) {
  const elapsed = worldTimeMs % CYCLE_MS
  return phases.find((phase) => elapsed >= phase.start && elapsed < phase.end)
}

function heading(from, to) {
  return Math.atan2(to.x - from.x, to.z - from.z)
}

function pointAlong(points, fraction) {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.z - points[index].z))
  const total = lengths.reduce((sum, value) => sum + value, 0)
  let distance = Math.max(0, Math.min(1, fraction)) * total
  for (let index = 0; index < lengths.length; index++) {
    if (distance <= lengths[index] || index === lengths.length - 1) {
      const progress = lengths[index] ? distance / lengths[index] : 0
      const from = points[index]
      const to = points[index + 1]
      return { x: from.x + (to.x - from.x) * progress, z: from.z + (to.z - from.z) * progress, heading: heading(from, to) }
    }
    distance -= lengths[index]
  }
  return { ...points.at(-1), heading: 0 }
}

function workerPosition(phase, elapsed) {
  if (phase.phase === 'commute_to_cart') return pointAlong(PROOF_ROUTE, (elapsed - phase.start) / (phase.end - phase.start))
  if (phase.phase === 'commute_home') return pointAlong([...PROOF_ROUTE].reverse(), (elapsed - phase.start) / (phase.end - phase.start))
  if (phase.phase === 'home') return { ...PROOF_HOME, heading: Math.PI / 2 }
  if (phase.phase === 'break') return { x: -531.6, z: -39.7, heading: 0 }
  return { ...PROOF_CART.workerSpot, heading: Math.PI }
}

function customerState(customer, index, elapsed) {
  const arrival = arrivals[index]
  const end = serviceEnds[index]
  const departure = departures[index]
  if (elapsed < arrival || elapsed >= departure) return null
  const entry = { x: -531.35, z: -46 }
  const spot = PROOF_CART.queueSpots[index === 1 || index === 3 ? 1 : 0]
  const approachEnd = arrival + 30_000
  const leaveStart = end
  if (elapsed < approachEnd) {
    const position = pointAlong([entry, spot], (elapsed - arrival) / (approachEnd - arrival))
    return { ...customer, ...position, phase: 'approaching', animation: 'walk' }
  }
  if (elapsed >= leaveStart) {
    const position = pointAlong([spot, entry], (elapsed - leaveStart) / (departure - leaveStart))
    return { ...customer, ...position, phase: 'leaving', animation: 'walk' }
  }
  const phase = elapsed >= serviceStarts[index] ? 'being_served' : 'waiting'
  return { ...customer, ...spot, heading: Math.PI, phase, animation: phase === 'being_served' ? 'talk' : 'idle' }
}

function cartState(elapsed) {
  const served = serviceEnds.filter((at) => elapsed >= at).length
  const restocked = elapsed >= 600_000
  return {
    ...PROOF_CART,
    stock: 6 - served + (restocked ? 4 : 0),
    queue: arrivals.filter((at, index) => elapsed >= at + 30_000 && elapsed < serviceStarts[index]).length,
    served,
    open: elapsed >= 360_000 && elapsed < 1_130_000,
  }
}

function customerPool(store, workerId) {
  const nearby = store.db.prepare(`
    SELECT n.id,n.display_name AS name FROM npc n JOIN household h ON h.id=n.household_id
    WHERE h.home_anchor_id IN (?,?) AND n.id<>? ORDER BY n.id LIMIT 4
  `).all(WORK_ANCHOR, HOME_ANCHOR, workerId)
  if (nearby.length >= 4) return nearby
  const used = new Set([workerId, ...nearby.map((npc) => npc.id)])
  const fallback = store.db.prepare('SELECT id,display_name AS name FROM npc ORDER BY id LIMIT 16').all()
  return [...nearby, ...fallback.filter((npc) => !used.has(npc.id))].slice(0, 4)
}

export class ProofError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function createProofService({ databasePath = DEFAULT_DATABASE_PATH, now = Date.now } = {}) {
  let store
  let worker
  let customers
  let worldTimeMs
  let persistedTimeMs
  let speed
  let paused
  let lastWallMs

  function ensureOpen() {
    if (store) return
    try {
      store = openPopulationDatabase(databasePath, { create: false })
      for (const id of [HOME_ANCHOR, WORK_ANCHOR]) {
        if (store.db.prepare("SELECT 1 FROM map_anchor WHERE id=? AND kind='building'").get(id) === undefined) {
          throw new Error(`The proof requires map building anchor ${id}`)
        }
      }
      const savedWorker = store.getMeta(META.workerId)
      const selected = savedWorker === null
        ? store.db.prepare(`
          SELECT n.id FROM npc n JOIN household h ON h.id=n.household_id
          WHERE h.home_anchor_id=? AND n.role='worker' ORDER BY n.id LIMIT 1
        `).get(HOME_ANCHOR)
        : { id: Number(savedWorker) }
      if (!selected?.id) throw new Error(`Seed a mapped worker at ${HOME_ANCHOR} before running the proof`)
      worker = store.getNpc(selected.id)
      if (!worker || worker.role !== 'worker' || worker.home_anchor_id !== HOME_ANCHOR) {
        throw new Error('The saved proof worker no longer matches the mapped home')
      }
      const work = worker.assignments.find((assignment) => assignment.kind === 'work')
      if (work?.provenance === 'verified' && work.anchor_id !== WORK_ANCHOR) {
        throw new Error('The proof worker has a verified job elsewhere')
      }
      if (work?.anchor_id !== WORK_ANCHOR || work.schedule_code !== 'proof_cart_shift') {
        store.setAssignment({ npcId: worker.id, kind: 'work', anchorId: WORK_ANCHOR, scheduleCode: 'proof_cart_shift', provenance: 'synthetic' })
      }
      customers = customerPool(store, worker.id)
      if (customers.length < 4) throw new Error('The proof needs four seeded customer identities')
      worldTimeMs = finiteClock(store.getMeta(META.clock), 0)
      persistedTimeMs = worldTimeMs
      speed = finiteSpeed(store.getMeta(META.speed), DEFAULT_SPEED)
      paused = store.getMeta(META.paused) === '1'
      lastWallMs = now()
      if (savedWorker === null) transaction(store.db, () => {
        store.setMeta(META.workerId, String(worker.id))
        store.setMeta(META.version, '1')
        store.setMeta(META.clock, String(worldTimeMs))
        store.setMeta(META.speed, String(speed))
        store.setMeta(META.paused, paused ? '1' : '0')
        saveCheckpoint()
      })
    } catch (error) {
      store?.close()
      store = undefined
      throw error
    }
  }

  function saveCheckpoint() {
    const elapsed = worldTimeMs % CYCLE_MS
    const phase = phaseAt(worldTimeMs)
    const routeStartMs = phase.phase.startsWith('commute_') ? worldTimeMs - elapsed + phase.start : null
    const routeEndMs = routeStartMs === null ? null : worldTimeMs - elapsed + phase.end
    store.saveCheckpoint({
      npcId: worker.id,
      worldTimeMs,
      activity: `proof_${phase.phase}`,
      destinationAnchorId: phase.phase === 'commute_to_cart' || (elapsed >= 270_000 && elapsed < 1_130_000) ? WORK_ANCHOR : HOME_ANCHOR,
      routeStartMs, routeEndMs,
      status: { proofVersion: 1, shift: Math.floor(worldTimeMs / CYCLE_MS) + 1, phase: phase.phase, stock: cartState(elapsed).stock, served: cartState(elapsed).served },
    })
    store.setMeta(META.clock, String(worldTimeMs))
    persistedTimeMs = worldTimeMs
  }

  function appendCrossedEvents(before, after) {
    const firstCycle = Math.floor(before / CYCLE_MS)
    const lastCycle = Math.floor(after / CYCLE_MS)
    let startCycle = firstCycle
    if (lastCycle - firstCycle > MAX_DETAILED_CYCLES) {
      startCycle = lastCycle - MAX_DETAILED_CYCLES
      store.appendEvent({
        npcId: worker.id, worldTimeMs: startCycle * CYCLE_MS,
        eventType: 'proof_fast_forward', payload: { skippedShifts: startCycle - firstCycle },
        idempotencyKey: `npc-proof-v1:${worker.id}:fast-forward:${startCycle}`,
      })
    }
    for (let cycle = startCycle; cycle <= lastCycle; cycle++) {
      for (const event of events) {
        const at = cycle * CYCLE_MS + event.at
        if (at <= before || at > after) continue
        const customer = event.customer === undefined ? null : customers[event.customer]
        store.appendEvent({
          npcId: worker.id, worldTimeMs: at,
          eventType: `proof_${event.type}`,
          payload: { shift: cycle + 1, ...(customer ? { customerId: customer.id, customerName: customer.name } : {}) },
          idempotencyKey: `npc-proof-v1:${worker.id}:${at}:${event.type}`,
        })
        if (customer) store.appendEvent({
          npcId: customer.id, worldTimeMs: at, eventType: 'proof_purchased_food',
          payload: { shift: cycle + 1, workerId: worker.id, cart: '7th-ave-times-square' },
          idempotencyKey: `npc-proof-v1:${customer.id}:${at}:purchased-food`,
        })
      }
    }
  }

  function flush(force = false) {
    if (!force && worldTimeMs - persistedTimeMs < PERSIST_EVERY_WORLD_MS) return
    transaction(store.db, () => saveCheckpoint())
  }

  function advance() {
    ensureOpen()
    const wall = now()
    if (!Number.isFinite(wall)) throw new Error('Clock returned a non-finite value')
    const elapsedWall = Math.max(0, wall - lastWallMs)
    lastWallMs = wall
    if (paused || elapsedWall === 0) return
    const next = worldTimeMs + Math.round(elapsedWall * speed)
    if (!Number.isSafeInteger(next)) throw new Error('Proof clock exceeded the safe integer range')
    const before = worldTimeMs
    worldTimeMs = next
    try {
      if (events.some((event) => Math.floor((before - event.at) / CYCLE_MS) !== Math.floor((next - event.at) / CYCLE_MS))) {
        transaction(store.db, () => {
          appendCrossedEvents(before, next)
          saveCheckpoint()
        })
      } else flush()
    } catch (error) {
      worldTimeMs = before
      throw error
    }
  }

  function state() {
    advance()
    const elapsed = worldTimeMs % CYCLE_MS
    const phase = phaseAt(worldTimeMs)
    const position = workerPosition(phase, elapsed)
    return {
      version: 1,
      worldTimeMs,
      shift: Math.floor(worldTimeMs / CYCLE_MS) + 1,
      shiftElapsedMs: elapsed,
      shiftDurationMs: CYCLE_MS,
      speed,
      paused,
      worker: {
        id: worker.id, name: worker.display_name, ...position,
        phase: phase.phase, taskLabel: phase.taskLabel, animation: phase.animation,
        home: { ...PROOF_HOME }, work: { ...PROOF_CART.workerSpot },
        homeAnchorId: HOME_ANCHOR, workAnchorId: WORK_ANCHOR,
      },
      cart: cartState(elapsed),
      customers: customers.map((customer, index) => customerState(customer, index, elapsed)).filter(Boolean),
      route: { outbound: PROOF_ROUTE, returning: [...PROOF_ROUTE].reverse() },
    }
  }

  function control(command) {
    if (!command || typeof command !== 'object' || Array.isArray(command)) throw new ProofError(400, 'Expected a control object')
    advance()
    const { action } = command
    switch (action) {
      case 'pause': paused = true; break
      case 'resume': paused = false; break
      case 'reset':
        worldTimeMs = (Math.floor(worldTimeMs / CYCLE_MS) + 1) * CYCLE_MS
        if (!Number.isSafeInteger(worldTimeMs)) throw new ProofError(400, 'Proof clock cannot be reset again')
        break
      case 'speed':
        if (typeof command.speed !== 'number' || !Number.isFinite(command.speed) || command.speed < MIN_SPEED || command.speed > MAX_SPEED) {
          throw new ProofError(400, `speed must be a number from ${MIN_SPEED} to ${MAX_SPEED}`)
        }
        speed = command.speed
        break
      default: throw new ProofError(400, 'action must be pause, resume, reset, or speed')
    }
    transaction(store.db, () => {
      store.setMeta(META.paused, paused ? '1' : '0')
      store.setMeta(META.speed, String(speed))
      if (action === 'reset') store.appendEvent({
        npcId: worker.id, worldTimeMs, eventType: 'proof_reset',
        payload: { shift: Math.floor(worldTimeMs / CYCLE_MS) + 1 },
        idempotencyKey: `npc-proof-v1:${worker.id}:${worldTimeMs}:reset`,
      })
      saveCheckpoint()
    })
    lastWallMs = now()
    return state()
  }

  function close() {
    if (!store) return
    advance()
    flush(true)
    store.close()
    store = undefined
  }

  return { state, control, close }
}
