import { generateWeek, newYorkLocalTime, planSeedForWeek } from '../../server/population/weekly-core.mjs'
import type { NpcMeeting, NpcMember, NpcWeek } from '../../server/population/weekly-core.mjs'
import type { NearbyNpc, PopulationRequest, PopulationResponse } from './npcPopulationProtocol'

type FileSpec = { file: string; bytes: number; gzipBytes: number; hash: string }
type ShardSpec = FileSpec & { id: string; cx: number; cz: number; count: number }
type Manifest = { version: number; datasetId: string; totalMembers: number; totalRelationships: number;
  cellSize: number; firstWeek: string; materializedWeeks: string[]; places: FileSpec;
  relationships: FileSpec; shards: ShardSpec[] }
type MeetingTuple = [string, string, number, number, string, number, number, number, string]
type StoredMember = NpcMember & { meetings: MeetingTuple[] }
type Place = { id: string; anchor_id: string; kind: string; label: string; x: number; z: number }

const MAX_ACTIVE_SHARDS = 3
let baseUrl = ''
let manifest: Manifest | null = null
let cached = false
let cachePromise: Promise<IDBDatabase | null> | null = null
const inFlight = new Map<string, Promise<unknown>>()
const downloaded = new Set<string>()
const active = new Map<string, StoredMember[]>()
const memberToShard = new Map<number, string>()
const places = new Map<string, Place>()
let loadedMembers = 0
let ready = false

function send(message: PopulationResponse): void { self.postMessage(message) }

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result)
    operation.onerror = () => reject(operation.error)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function openCache(): Promise<IDBDatabase | null> {
  if (cachePromise) return cachePromise
  cachePromise = new Promise((resolve) => {
    if (!('indexedDB' in self)) { resolve(null); return }
    const operation = indexedDB.open('new-york-sim-npc-data', 1)
    operation.onupgradeneeded = () => {
      operation.result.createObjectStore('files')
      operation.result.createObjectStore('meta')
    }
    operation.onsuccess = () => resolve(operation.result)
    operation.onerror = () => resolve(null)
    operation.onblocked = () => resolve(null)
  })
  return cachePromise
}

async function prepareCache(datasetId: string): Promise<void> {
  const db = await openCache()
  if (!db) return
  try {
    const previous = await request(db.transaction('meta').objectStore('meta').get('datasetId'))
    if (previous !== datasetId) {
      const tx = db.transaction(['files', 'meta'], 'readwrite')
      tx.objectStore('files').clear()
      tx.objectStore('meta').put(datasetId, 'datasetId')
      await transactionDone(tx)
    }
    cached = true
  } catch { cached = false }
}

async function cacheRead(file: string): Promise<string | null> {
  if (!cached) return null
  const db = await openCache()
  if (!db) return null
  try {
    const value = await request(db.transaction('files').objectStore('files').get(file))
    return typeof value === 'string' ? value : null
  } catch { return null }
}

async function cacheWrite(file: string, content: string): Promise<void> {
  if (!cached) return
  const db = await openCache()
  if (!db) return
  try {
    const tx = db.transaction('files', 'readwrite')
    tx.objectStore('files').put(content, file)
    await transactionDone(tx)
  } catch { cached = false }
}

async function valid(content: string, spec: FileSpec): Promise<boolean> {
  const bytes = new TextEncoder().encode(content)
  if (bytes.length !== spec.bytes) return false
  if (!crypto.subtle) return true
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('')
  return hex === spec.hash
}

async function loadFile<T>(spec: FileSpec): Promise<T> {
  const pending = inFlight.get(spec.file)
  if (pending) return pending as Promise<T>
  const operation = (async () => {
    let content = await cacheRead(spec.file)
    if (content && !(await valid(content, spec))) content = null
    if (!content) {
      const response = await fetch(`${baseUrl}${spec.file}?v=${manifest?.datasetId ?? ''}`)
      if (!response.ok) throw new Error(`${spec.file}: HTTP ${response.status}`)
      content = await response.text()
      if (!(await valid(content, spec))) throw new Error(`${spec.file}: data check failed`)
      await cacheWrite(spec.file, content)
    }
    return JSON.parse(content) as T
  })()
  inFlight.set(spec.file, operation)
  try { return await operation } finally { inFlight.delete(spec.file) }
}

function shardDistance(spec: ShardSpec, x: number, z: number): number {
  const size = manifest?.cellSize ?? 384
  const dx = Math.max(spec.cx * size - x, 0, x - (spec.cx + 1) * size)
  const dz = Math.max(spec.cz * size - z, 0, z - (spec.cz + 1) * size)
  return dx * dx + dz * dz
}

function orderedShards(x: number, z: number): ShardSpec[] {
  return [...(manifest?.shards ?? [])].sort((a, b) =>
    shardDistance(a, x, z) - shardDistance(b, x, z) || a.id.localeCompare(b.id))
}

function reportProgress(): void {
  if (!manifest) return
  send({ type: 'progress', loaded: loadedMembers, total: manifest.totalMembers,
    shardsLoaded: downloaded.size, shardsTotal: manifest.shards.length, cached })
}

async function loadShard(spec: ShardSpec, keepActive: boolean): Promise<void> {
  if (downloaded.has(spec.id) && (!keepActive || active.has(spec.id))) {
    if (keepActive) {
      const rows = active.get(spec.id)!
      active.delete(spec.id)
      active.set(spec.id, rows)
    }
    return
  }
  const payload = await loadFile<{ version: number; id: string; members: StoredMember[] }>(spec)
  if (payload.version !== 1 || payload.id !== spec.id || payload.members.length !== spec.count) {
    throw new Error(`${spec.file}: unexpected NPC records`)
  }
  if (!downloaded.has(spec.id)) {
    downloaded.add(spec.id)
    loadedMembers += payload.members.length
    for (const member of payload.members) memberToShard.set(member.npc_id, spec.id)
    reportProgress()
  }
  if (keepActive) {
    active.delete(spec.id)
    active.set(spec.id, payload.members)
    while (active.size > MAX_ACTIVE_SHARDS) active.delete(active.keys().next().value!)
  }
}

function memberById(id: number): StoredMember | null {
  for (const rows of active.values()) {
    const member = rows.find((item) => item.npc_id === id)
    if (member) return member
  }
  return null
}

function weekFor(member: StoredMember, weekStart: string): NpcWeek {
  if (!manifest) throw new Error('Population has not loaded')
  const { meetings: tuples, ...profile } = member
  const meetings: NpcMeeting[] = tuples.filter((item) => item[1] === weekStart).map((item) => ({
    id: item[0], week_start: item[1], npc_a_id: item[2], npc_b_id: item[3], place_id: item[4],
    weekday: item[5], start_minute: item[6], duration_minute: item[7], status: item[8], viewer_id: member.npc_id,
  }))
  const seed = weekStart === manifest.firstWeek ? member.plan_seed : planSeedForWeek(member.plan_seed, weekStart)
  return generateWeek(profile, meetings, weekStart, manifest.materializedWeeks.includes(weekStart), seed)
}

function currentFor(member: StoredMember, timeMs: number) {
  const local = newYorkLocalTime(timeMs)
  const week = weekFor(member, local.weekStart)
  const day = week.days.find((item) => item.localDate === local.localDate)!
  const index = day.episodes.findIndex((item) => item.startMinute <= local.minute && local.minute < item.endMinute)
  return { local, week, current: day.episodes[index],
    next: day.episodes[index + 1] ?? week.days[(day.weekday + 1) % 7].episodes[0] }
}

async function initialize(message: Extract<PopulationRequest, { type: 'init' }>): Promise<void> {
  baseUrl = message.baseUrl.endsWith('/') ? message.baseUrl : `${message.baseUrl}/`
  try {
    const response = await fetch(`${baseUrl}manifest.json`, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`NPC manifest: HTTP ${response.status}`)
    manifest = await response.json() as Manifest
    if (manifest.version !== 1 || manifest.totalMembers !== 100000 || !manifest.shards.length) {
      throw new Error('NPC manifest is incomplete')
    }
    await prepareCache(manifest.datasetId)
    const placeData = await loadFile<{ version: number; places: Place[] }>(manifest.places)
    if (placeData.version !== 1) throw new Error('NPC places are unavailable')
    for (const place of placeData.places) places.set(place.id, place)
    const ordered = orderedShards(message.x, message.z)
    await loadShard(ordered[0], true)
    ready = true
    send({ type: 'ready', loaded: loadedMembers, total: manifest.totalMembers, cached })
    for (const spec of ordered.slice(1)) await loadShard(spec, false)
    const relations = await loadFile<{ version: number; relationships: unknown[] }>(manifest.relationships)
    if (relations.version !== 1 || relations.relationships.length !== manifest.totalRelationships) {
      throw new Error('NPC relationships are incomplete')
    }
    if (loadedMembers !== manifest.totalMembers) throw new Error('NPC population count is incomplete')
    send({ type: 'complete', loaded: loadedMembers, total: manifest.totalMembers,
      relationships: relations.relationships.length, cached })
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error), initial: !ready })
  }
}

async function nearby(message: Extract<PopulationRequest, { type: 'nearby' }>): Promise<void> {
  if (!manifest || !ready) return
  try {
    for (const shard of orderedShards(message.x, message.z).slice(0, MAX_ACTIVE_SHARDS)) await loadShard(shard, true)
    const candidates = [...active.values()].flat().map((member) => {
      const home = places.get(member.home_place_id)
      const work = member.work_place_id ? places.get(member.work_place_id) : null
      const homeDistance = home ? Math.hypot(home.x - message.x, home.z - message.z) : Infinity
      const workDistance = work ? Math.hypot(work.x - message.x, work.z - message.z) : Infinity
      return { member, distance: Math.min(homeDistance, workDistance) }
    }).sort((a, b) => a.distance - b.distance || a.member.npc_id - b.member.npc_id)
      .slice(0, Math.max(message.limit * 12, 80))
    const people: NearbyNpc[] = []
    for (const { member } of candidates) {
      const state = currentFor(member, message.timeMs)
      const place = places.get(state.current.placeId)
      if (!place) continue
      const distance = Math.hypot(place.x - message.x, place.z - message.z)
      if (distance > message.radius) continue
      people.push({ npcId: member.npc_id, name: member.display_name, role: member.role,
        appearanceSeed: member.appearance_seed,
        activity: state.current.activity, placeId: place.id, placeLabel: place.label,
        x: place.x, z: place.z, distance })
    }
    people.sort((a, b) => a.distance - b.distance || a.npcId - b.npcId)
    send({ type: 'nearby', requestId: message.requestId, people: people.slice(0, message.limit) })
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error), initial: false })
  }
}

async function inspect(message: Extract<PopulationRequest, { type: 'inspect' }>): Promise<void> {
  if (!manifest || !ready) return
  try {
    let member = memberById(message.npcId)
    if (!member) {
      const shardId = memberToShard.get(message.npcId)
      const shard = manifest.shards.find((item) => item.id === shardId)
      if (shard) { await loadShard(shard, true); member = memberById(message.npcId) }
    }
    if (!member) { send({ type: 'inspect', requestId: message.requestId, result: null }); return }
    const state = currentFor(member, message.timeMs)
    send({ type: 'inspect', requestId: message.requestId, result: {
      npcId: member.npc_id, name: member.display_name, role: member.role, localDate: state.local.localDate,
      current: state.current, next: state.next, currentPlace: places.get(state.current.placeId)?.label ?? state.current.placeId,
      week: state.week,
    } })
  } catch (error) {
    send({ type: 'inspect', requestId: message.requestId, result: null,
      error: error instanceof Error ? error.message : String(error) })
  }
}

self.onmessage = (event: MessageEvent<PopulationRequest>) => {
  const message = event.data
  if (message.type === 'init') void initialize(message)
  else if (message.type === 'nearby') void nearby(message)
  else if (message.type === 'inspect') void inspect(message)
}
