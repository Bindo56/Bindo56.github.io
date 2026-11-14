import { randomUUID } from 'node:crypto'
import { transaction } from './database.mjs'
import { generateWeek, mondayOf, newYorkLocalTime } from './weekly-core.mjs'
export { mix, mondayOf, planSeedForWeek, newYorkLocalTime, workWindow, canMeet } from './weekly-core.mjs'

export function getWeek(store, npcId, weekStart) {
  if (!Number.isSafeInteger(npcId) || npcId < 1) throw new RangeError('Invalid NPC ID')
  if (mondayOf(weekStart) !== weekStart) throw new RangeError('weekStart must be a Monday in YYYY-MM-DD form')
  const member = store.db.prepare(`SELECT m.*, n.display_name, n.household_id FROM sim_member m JOIN npc n ON n.id=m.npc_id WHERE m.npc_id=?`).get(npcId)
  if (!member) return null
  const week = store.db.prepare('SELECT * FROM sim_week WHERE npc_id=? AND week_start=?').get(npcId, weekStart)
  const meetings = store.db.prepare(`
    SELECT *, ? AS viewer_id FROM sim_meeting
    WHERE week_start=? AND status<>'cancelled' AND (npc_a_id=? OR npc_b_id=?)
    ORDER BY weekday,start_minute,id
  `).all(npcId, weekStart, npcId, npcId)
  return generateWeek(member, meetings, weekStart, Boolean(week), week?.plan_seed)
}

export function getStateAt(store, npcId, worldTimeMs) {
  const local = newYorkLocalTime(worldTimeMs)
  const week = getWeek(store, npcId, local.weekStart)
  if (!week) return null
  const day = week.days.find((item) => item.localDate === local.localDate)
  const index = day.episodes.findIndex((item) => item.startMinute <= local.minute && local.minute < item.endMinute)
  const current = day.episodes[index]
  return { npcId, worldTimeMs, localDate: local.localDate, localMinute: local.minute,
    current, next: day.episodes[index + 1] ?? week.days[(day.weekday + 1) % 7].episodes[0],
    profile: week.profile, weekStart: week.weekStart }
}

export function getRelationships(store, npcId) {
  return store.db.prepare(`
    SELECT r.*, CASE WHEN npc_a_id=? THEN npc_b_id ELSE npc_a_id END AS other_npc_id,
           n.display_name AS other_name
    FROM sim_relationship r JOIN npc n ON n.id=CASE WHEN npc_a_id=? THEN npc_b_id ELSE npc_a_id END
    WHERE npc_a_id=? OR npc_b_id=? ORDER BY r.kind,other_npc_id
  `).all(npcId, npcId, npcId, npcId)
}

export function recordInteraction(store, { npcIds, worldTimeMs, placeId = null, kind, outcome = {}, idempotencyKey = randomUUID() }) {
  if (!Array.isArray(npcIds) || npcIds.length < 1 || npcIds.length > 8 ||
      npcIds.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(npcIds).size !== npcIds.length) {
    throw new TypeError('npcIds must contain 1..8 distinct positive NPC IDs')
  }
  if (!Number.isSafeInteger(worldTimeMs) || worldTimeMs < 0) throw new RangeError('Invalid worldTimeMs')
  if (typeof kind !== 'string' || !/^[a-z][a-z_]{1,63}$/.test(kind)) throw new TypeError('Invalid interaction kind')
  if (typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 160) throw new TypeError('Invalid idempotency key')
  if (outcome === null || typeof outcome !== 'object' || Array.isArray(outcome)) throw new TypeError('outcome must be an object')
  const encoded = JSON.stringify(outcome)
  if (encoded.length > 4096) throw new RangeError('outcome is too large')
  if (placeId !== null && !store.db.prepare('SELECT 1 FROM sim_place WHERE id=?').get(placeId)) throw new Error('Unknown simulation place')
  for (const npcId of npcIds) if (!store.db.prepare('SELECT 1 FROM sim_member WHERE npc_id=?').get(npcId)) {
    throw new Error(`NPC ${npcId} is not in the simulated cohort`)
  }
  return transaction(store.db, () => {
    const previous = store.db.prepare('SELECT * FROM sim_interaction WHERE idempotency_key=?').get(idempotencyKey)
    if (previous) {
      if (previous.world_time_ms !== worldTimeMs || previous.place_id !== placeId || previous.kind !== kind || previous.outcome_json !== encoded) {
        throw new Error('Idempotency key already belongs to another interaction')
      }
      const participants = store.db.prepare('SELECT npc_id FROM sim_interaction_participant WHERE interaction_id=? ORDER BY npc_id')
        .all(previous.id).map((row) => row.npc_id)
      if (participants.join(',') !== [...npcIds].sort((a, b) => a - b).join(',')) throw new Error('Idempotency key has different participants')
      return { id: previous.id, inserted: false }
    }
    const inserted = store.db.prepare('INSERT INTO sim_interaction(world_time_ms,place_id,kind,outcome_json,idempotency_key) VALUES(?,?,?,?,?)')
      .run(worldTimeMs, placeId, kind, encoded, idempotencyKey)
    const id = Number(inserted.lastInsertRowid)
    const add = store.db.prepare('INSERT INTO sim_interaction_participant(interaction_id,npc_id,participant_role) VALUES(?,?,?)')
    for (const npcId of npcIds) {
      add.run(id, npcId, 'participant')
      store.appendEvent({ npcId, worldTimeMs, eventType: `interaction_${kind}`, payload: { interactionId: id, placeId, otherNpcIds: npcIds.filter((other) => other !== npcId), outcome },
        idempotencyKey: `sim-interaction:${id}:${npcId}` })
    }
    if (npcIds.length === 2 && Number.isInteger(outcome.relationshipDelta) && Math.abs(outcome.relationshipDelta) <= 5) {
      const [a, b] = [...npcIds].sort((left, right) => left - right)
      store.db.prepare(`UPDATE sim_relationship SET strength=MIN(100,MAX(0,strength+?))
        WHERE npc_a_id=? AND npc_b_id=? AND kind='friend'`).run(outcome.relationshipDelta, a, b)
    }
    return { id, inserted: true }
  })
}
