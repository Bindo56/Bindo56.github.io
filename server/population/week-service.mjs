import { DEFAULT_DATABASE_PATH, openPopulationDatabase } from './database.mjs'
import { COHORT_KEY } from './seed-weekly.mjs'
import { getRelationships, getStateAt, getWeek, newYorkLocalTime } from './weekly.mjs'

export function createWeekService({ databasePath = DEFAULT_DATABASE_PATH, now = Date.now } = {}) {
  let store
  function database() {
    if (!store) store = openPopulationDatabase(databasePath, { create: false })
    return store
  }
  function member(npcId) {
    const id = Number(npcId)
    if (!Number.isSafeInteger(id) || id < 1) throw new RangeError('Invalid NPC ID')
    return id
  }
  function summary() {
    const db = database().db
    return { cohort: db.prepare('SELECT * FROM sim_cohort WHERE cohort_key=?').get(COHORT_KEY) ?? null,
      memberCount: db.prepare('SELECT COUNT(*) AS n FROM sim_member WHERE cohort_key=?').get(COHORT_KEY).n,
      placeKinds: db.prepare('SELECT kind,COUNT(*) AS count FROM sim_place WHERE active=1 GROUP BY kind ORDER BY kind').all(),
      relationshipKinds: db.prepare('SELECT kind,COUNT(*) AS count FROM sim_relationship GROUP BY kind ORDER BY kind').all(),
      weeks: db.prepare('SELECT week_start,COUNT(*) AS count FROM sim_week GROUP BY week_start ORDER BY week_start').all() }
  }
  function places({ kind, after = '', limit = 100 } = {}) {
    if (typeof kind !== 'string' || !/^[a-z_]+$/.test(kind)) throw new TypeError('kind is required')
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new RangeError('limit must be 1..200')
    return database().db.prepare(`SELECT p.id,p.kind,p.provenance,p.label,p.capacity,p.anchor_id,p.zone_id,a.x,a.z,
      s.dataset AS source,s.source_id,s.match_method,s.distance_m
      FROM sim_place p JOIN map_anchor a ON a.id=p.anchor_id LEFT JOIN sim_place_source s ON s.place_id=p.id
      WHERE p.active=1 AND p.kind=? AND p.id>? ORDER BY p.id LIMIT ?`)
      .all(kind, after, limit)
  }
  function person(npcId, worldTimeMs = now()) {
    const state = getStateAt(database(), member(npcId), worldTimeMs)
    if (!state) return null
    const place = state.current?.placeId ? database().db.prepare(`SELECT p.id,p.kind,p.provenance,p.label,p.anchor_id,a.x,a.z
      FROM sim_place p JOIN map_anchor a ON a.id=p.anchor_id WHERE p.id=?`).get(state.current.placeId) : null
    const inTransit = state.current?.activity.startsWith('commute_') ?? false
    return { ...state, location: inTransit ? { kind: 'in_transit', destination: place } : place,
      relationshipCount: database().db.prepare('SELECT COUNT(*) AS n FROM sim_relationship WHERE npc_a_id=? OR npc_b_id=?')
        .get(state.npcId, state.npcId).n }
  }
  function week(npcId, weekStart = newYorkLocalTime(now()).weekStart) {
    return getWeek(database(), member(npcId), weekStart)
  }
  function relationships(npcId) {
    return getRelationships(database(), member(npcId))
  }
  function close() { store?.close(); store = undefined }
  return { summary, places, person, week, relationships, close }
}
