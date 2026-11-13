import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { backup, DatabaseSync } from 'node:sqlite'

const migrationDir = fileURLToPath(new URL('./migrations/', import.meta.url))
export const DEFAULT_DATABASE_PATH = resolve(process.cwd(), 'data', 'population.sqlite')

function positiveId(value, label = 'NPC ID') {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive safe integer`)
  return value
}

function nonnegativeTime(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('worldTimeMs must be a nonnegative integer')
  return value
}

function json(value, label) {
  const encoded = JSON.stringify(value ?? {})
  if (encoded === undefined || encoded.length > 4096 || Array.isArray(value) || typeof (value ?? {}) !== 'object') {
    throw new RangeError(`${label} must be a JSON object of at most 4096 characters`)
  }
  return encoded
}

export function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function migrate(db) {
  const files = readdirSync(migrationDir).filter((name) => /^\d{3}_[\w-]+\.sql$/.test(name)).sort()
  const current = db.prepare('PRAGMA user_version').get().user_version
  if (current > files.length) throw new Error(`Database schema ${current} is newer than this application (${files.length})`)
  for (let index = current; index < files.length; index++) {
    const version = index + 1
    if (Number(files[index].slice(0, 3)) !== version) throw new Error(`Missing migration ${version}`)
    transaction(db, () => {
      db.exec(readFileSync(join(migrationDir, files[index]), 'utf8'))
      db.exec(`PRAGMA user_version = ${version}`)
    })
  }
}

export function openPopulationDatabase(path = DEFAULT_DATABASE_PATH, { create = true } = {}) {
  if (!create && !existsSync(path)) throw new Error(`Database does not exist: ${path}`)
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path, { timeout: 5000 })
  try {
    db.exec('PRAGMA foreign_keys = ON')
    if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('SQLite foreign keys are unavailable')
    db.prepare('PRAGMA journal_mode = WAL').get()
    migrate(db)
    return new PopulationDatabase(db, path)
  } catch (error) {
    db.close()
    throw error
  }
}

export class PopulationDatabase {
  constructor(db, path) {
    this.db = db
    this.path = path
  }

  close() { this.db.close() }

  getMeta(key) {
    return this.db.prepare('SELECT value FROM population_meta WHERE key = ?').get(key)?.value ?? null
  }

  setMeta(key, value) {
    if (!key || typeof value !== 'string') throw new TypeError('Metadata requires a key and string value')
    this.db.prepare('INSERT INTO population_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
  }

  getWorldTime() {
    const value = this.getMeta('world_time_ms')
    return value === null ? null : Number(value)
  }

  saveWorldTime(worldTimeMs) {
    this.setMeta('world_time_ms', String(nonnegativeTime(worldTimeMs)))
  }

  getNpc(id) {
    positiveId(id)
    const person = this.db.prepare(`
      SELECT n.*, h.home_anchor_id
      FROM npc n JOIN household h ON h.id=n.household_id
      WHERE n.id=?
    `).get(id)
    if (!person) return null
    person.assignments = this.db.prepare('SELECT kind,anchor_id,schedule_code,provenance FROM npc_assignment WHERE npc_id=? ORDER BY kind').all(id)
    const state = this.db.prepare('SELECT * FROM npc_state WHERE npc_id=?').get(id)
    person.state = state ? { ...state, status: JSON.parse(state.status_json) } : null
    if (person.state) delete person.state.status_json
    return person
  }

  listNpcByHomeArea(zoneId, { afterId = 0, limit = 100 } = {}) {
    if (typeof zoneId !== 'string' || !zoneId) throw new TypeError('zoneId is required')
    if (!Number.isSafeInteger(afterId) || afterId < 0) throw new RangeError('afterId must be nonnegative')
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError('limit must be between 1 and 500')
    return this.db.prepare(`
      SELECT n.id,n.display_name,n.role,n.household_id,h.home_anchor_id
      FROM npc n JOIN household h ON h.id=n.household_id
      WHERE n.home_zone_id=? AND n.id>? ORDER BY n.id LIMIT ?
    `).all(zoneId, afterId, limit)
  }

  moveHousehold(householdId, homeAnchorId) {
    positiveId(householdId, 'Household ID')
    const anchor = this.db.prepare('SELECT kind FROM map_anchor WHERE id=?').get(homeAnchorId)
    if (!anchor || !['building', 'off_map'].includes(anchor.kind)) throw new Error('Home must be a known building or off-map anchor')
    return transaction(this.db, () => {
      const result = this.db.prepare('UPDATE household SET home_anchor_id=? WHERE id=?').run(homeAnchorId, householdId)
      if (!result.changes) throw new Error(`Unknown household ${householdId}`)
    })
  }

  setAssignment({ npcId, kind, anchorId, scheduleCode, provenance = 'verified' }) {
    positiveId(npcId)
    if (!['work', 'school'].includes(kind)) throw new TypeError('Assignment kind must be work or school')
    if (typeof scheduleCode !== 'string' || !scheduleCode || scheduleCode.length > 80) throw new TypeError('Invalid schedule code')
    if (!['synthetic', 'verified'].includes(provenance)) throw new TypeError('Invalid assignment provenance')
    const anchor = this.db.prepare('SELECT kind FROM map_anchor WHERE id=?').get(anchorId)
    if (!anchor || !['building', 'off_map'].includes(anchor.kind)) throw new Error('Assignment must reference a building or off-map anchor')
    this.db.prepare(`
      INSERT INTO npc_assignment(npc_id,kind,anchor_id,schedule_code,provenance)
      VALUES(?,?,?,?,?) ON CONFLICT(npc_id,kind) DO UPDATE SET
      anchor_id=excluded.anchor_id,schedule_code=excluded.schedule_code,provenance=excluded.provenance
    `).run(npcId, kind, anchorId, scheduleCode, provenance)
  }

  saveCheckpoint({ npcId, worldTimeMs, activity, destinationAnchorId = null, roadId = null, routeStartMs = null, routeEndMs = null, status = {} }) {
    positiveId(npcId)
    nonnegativeTime(worldTimeMs)
    if (typeof activity !== 'string' || !activity || activity.length > 80) throw new TypeError('activity must be a short string')
    if (routeStartMs !== null) nonnegativeTime(routeStartMs)
    if (routeEndMs !== null) nonnegativeTime(routeEndMs)
    if (routeStartMs !== null && routeEndMs !== null && routeEndMs < routeStartMs) throw new RangeError('Route end precedes start')
    for (const [value, label] of [[destinationAnchorId, 'destination'], [roadId, 'road']]) {
      if (value !== null && !this.db.prepare('SELECT 1 FROM map_anchor WHERE id=?').get(value)) throw new Error(`Unknown ${label} anchor ${value}`)
    }
    if (roadId !== null && this.db.prepare('SELECT kind FROM map_anchor WHERE id=?').get(roadId).kind !== 'road') {
      throw new Error('roadId must refer to a road')
    }
    this.db.prepare(`
      INSERT INTO npc_state(npc_id,world_time_ms,activity,destination_anchor_id,road_id,route_start_ms,route_end_ms,status_json)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(npc_id) DO UPDATE SET
      world_time_ms=excluded.world_time_ms,activity=excluded.activity,
      destination_anchor_id=excluded.destination_anchor_id,road_id=excluded.road_id,
      route_start_ms=excluded.route_start_ms,route_end_ms=excluded.route_end_ms,status_json=excluded.status_json
      WHERE excluded.world_time_ms >= npc_state.world_time_ms
    `).run(npcId, worldTimeMs, activity, destinationAnchorId, roadId, routeStartMs, routeEndMs, json(status, 'status'))
  }

  appendEvent({ npcId, worldTimeMs, eventType, payload = {}, idempotencyKey = null }) {
    positiveId(npcId)
    nonnegativeTime(worldTimeMs)
    if (typeof eventType !== 'string' || !eventType || eventType.length > 80) throw new TypeError('eventType must be a short string')
    if (idempotencyKey !== null && (typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 160)) {
      throw new TypeError('Invalid idempotency key')
    }
    const encoded = json(payload, 'payload')
    const result = this.db.prepare(`
      INSERT INTO npc_event(npc_id,world_time_ms,event_type,payload_json,idempotency_key)
      VALUES(?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING
    `).run(npcId, worldTimeMs, eventType, encoded, idempotencyKey)
    if (!result.changes && idempotencyKey !== null) {
      const previous = this.db.prepare('SELECT npc_id,world_time_ms,event_type,payload_json FROM npc_event WHERE idempotency_key=?').get(idempotencyKey)
      if (previous.npc_id !== npcId || previous.world_time_ms !== worldTimeMs || previous.event_type !== eventType || previous.payload_json !== encoded) {
        throw new Error('Idempotency key was already used for a different event')
      }
    }
    return result.changes === 1
  }

  listEvents(npcId, { afterId = 0, limit = 100 } = {}) {
    positiveId(npcId)
    if (!Number.isSafeInteger(afterId) || afterId < 0) throw new RangeError('afterId must be nonnegative')
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError('limit must be between 1 and 500')
    return this.db.prepare('SELECT * FROM npc_event WHERE npc_id=? AND id>? ORDER BY id LIMIT ?').all(npcId, afterId, limit)
      .map(({ payload_json, ...row }) => ({ ...row, payload: JSON.parse(payload_json) }))
  }

  integrity() {
    const quick = this.db.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check)
    const foreignKeys = this.db.prepare('PRAGMA foreign_key_check').all()
    return { quick, foreignKeys, ok: quick.length === 1 && quick[0] === 'ok' && foreignKeys.length === 0 }
  }

  async backup(path) {
    if (resolve(path) === resolve(this.path)) throw new Error('Backup path must differ from database path')
    if (existsSync(path)) throw new Error(`Backup destination already exists: ${path}`)
    mkdirSync(dirname(path), { recursive: true })
    await backup(this.db, path)
  }
}
