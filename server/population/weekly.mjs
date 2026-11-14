import { randomUUID } from 'node:crypto'
import { transaction } from './database.mjs'

const ZONE = 'America/New_York'
const dateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function mix(seed, id, salt = 0) {
  let value = (seed ^ Math.imul(id, 0x9e3779b1) ^ salt) >>> 0
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b)
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
  return (value ^ (value >>> 16)) >>> 0
}

function dateAt(localDate, days) {
  const date = new Date(`${localDate}T00:00:00Z`)
  if (Number.isNaN(date.valueOf())) throw new RangeError('Invalid local date')
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function mondayOf(localDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || dateAt(localDate, 0) !== localDate) {
    throw new RangeError('Expected a YYYY-MM-DD local date')
  }
  const day = new Date(`${localDate}T00:00:00Z`).getUTCDay()
  return dateAt(localDate, -((day + 6) % 7))
}

export function planSeedForWeek(planSeed, weekStart) {
  return mix(planSeed, Number(weekStart.replaceAll('-', '')), 0x725)
}

export function newYorkLocalTime(worldTimeMs) {
  if (!Number.isSafeInteger(worldTimeMs) || worldTimeMs < 0) throw new RangeError('worldTimeMs must be a nonnegative safe integer')
  const parts = Object.fromEntries(dateParts.formatToParts(new Date(worldTimeMs)).map(({ type, value }) => [type, value]))
  const localDate = `${parts.year}-${parts.month}-${parts.day}`
  return { localDate, weekStart: mondayOf(localDate), minute: Number(parts.hour) * 60 + Number(parts.minute) }
}

export function workWindow(member, weekday) {
  const days = {
    weekday: [0, 1, 2, 3, 4],
    staggered: [1, 2, 3, 4, 5],
    weekend: [0, 3, 4, 5, 6],
    four_day: [0, 1, 3, 4],
    school: [0, 1, 2, 3, 4],
    none: [],
  }[member.shift_pattern]
  if (!days) throw new Error(`Unknown shift pattern ${member.shift_pattern}`)
  if (!days.includes(weekday) || !member.work_place_id) return null
  if (member.shift_pattern === 'school') return { start: 8 * 60, end: 15 * 60 }
  if (member.chronotype === 'early') return { start: 6 * 60, end: 14 * 60 }
  if (member.chronotype === 'late') return { start: 13 * 60, end: 21 * 60 }
  return { start: 9 * 60, end: 17 * 60 }
}

function segment(start, end, activity, placeId, reason) {
  return { startMinute: Math.max(0, Math.round(start)), endMinute: Math.min(1440, Math.round(end)), activity, placeId, reason }
}

function fillDay(member, weekday) {
  const work = workWindow(member, weekday)
  const bedtime = member.chronotype === 'early' ? 21 * 60 + 30 : member.chronotype === 'late' ? 23 * 60 + 45 : 23 * 60
  const defaultWake = member.chronotype === 'early' ? 5 * 60 : member.chronotype === 'late' ? 9 * 60 : 7 * 60
  const wake = work ? Math.min(defaultWake, work.start - member.commute_minute - 45) : defaultWake
  const items = [segment(0, wake, 'sleep', member.home_place_id, 'Regular rest')]
  if (work) {
    const depart = work.start - member.commute_minute
    items.push(segment(depart, work.start, 'commute_to_work', member.work_place_id, 'Scheduled shift'))
    const breakStart = Math.round((work.start + work.end) / 2) - 15
    items.push(segment(work.start, breakStart, member.shift_pattern === 'school' ? 'school' : 'work', member.work_place_id, 'Scheduled commitment'))
    items.push(segment(breakStart, breakStart + 30, 'meal_break', member.work_place_id, 'Mid-shift break'))
    items.push(segment(breakStart + 30, work.end, member.shift_pattern === 'school' ? 'school' : 'work', member.work_place_id, 'Scheduled commitment'))
    items.push(segment(work.end, work.end + member.commute_minute, 'commute_home', member.home_place_id, 'Returning home'))
    const freeAt = work.end + member.commute_minute + 45
    if (freeAt + 60 < bedtime) {
      const choice = mix(member.plan_seed, weekday, 0xabc) % 4
      const place = choice === 0 ? member.cafe_place_id : choice === 1 ? member.errand_place_id : member.leisure_place_id
      const activity = choice === 0 ? 'cafe_visit' : choice === 1 ? 'errand' : 'leisure'
      items.push(segment(freeAt, Math.min(freeAt + 60, bedtime - 15), activity, place, 'Personal choice'))
    }
  } else {
    const firstStart = Math.max(wake + 90, 10 * 60)
    const order = mix(member.plan_seed, weekday, 0xdef) % 3
    const first = [member.cafe_place_id, member.errand_place_id, member.leisure_place_id][order]
    const second = [member.leisure_place_id, member.cafe_place_id, member.errand_place_id][order]
    items.push(segment(firstStart, firstStart + 75, 'personal_outing', first, 'Day-off plan'))
    items.push(segment(15 * 60, 16 * 60 + 30, 'personal_outing', second, 'Day-off plan'))
  }
  items.push(segment(bedtime, 1440, 'sleep', member.home_place_id, 'Regular rest'))
  const ordered = items.filter((item) => item.endMinute > item.startMinute).sort((a, b) => a.startMinute - b.startMinute)
  const complete = []
  let cursor = 0
  for (const item of ordered) {
    if (item.startMinute < cursor) throw new Error(`Overlapping base schedule for NPC ${member.npc_id}`)
    if (cursor < item.startMinute) complete.push(segment(cursor, item.startMinute, 'home', member.home_place_id, 'Uncommitted time'))
    complete.push(item)
    cursor = item.endMinute
  }
  if (cursor < 1440) complete.push(segment(cursor, 1440, 'home', member.home_place_id, 'Uncommitted time'))
  return complete
}

function overlayMeeting(day, meeting) {
  const start = meeting.start_minute
  const end = start + meeting.duration_minute
  const result = []
  for (const item of day) {
    if (item.endMinute <= start || item.startMinute >= end) {
      result.push(item)
      continue
    }
    if (item.startMinute < start) result.push({ ...item, endMinute: start })
    if (item.endMinute > end) result.push({ ...item, startMinute: end })
  }
  result.push({ ...segment(start, end, 'social_meeting', meeting.place_id, 'Planned with a known person'), meetingId: meeting.id,
    withNpcId: meeting.npc_a_id === meeting.viewer_id ? meeting.npc_b_id : meeting.npc_a_id })
  return result.sort((a, b) => a.startMinute - b.startMinute)
}

export function canMeet(member, weekday, start, duration) {
  const work = workWindow(member, weekday)
  if (!work) return start >= 9 * 60 && start + duration <= 21 * 60
  const busyStart = work.start - member.commute_minute - 15
  const busyEnd = work.end + member.commute_minute + 15
  return (start + duration <= busyStart || start >= busyEnd) && start >= 9 * 60 && start + duration <= 21 * 60
}

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
  const plannedMember = { ...member, plan_seed: week?.plan_seed ?? planSeedForWeek(member.plan_seed, weekStart) }
  const days = Array.from({ length: 7 }, (_, weekday) => {
    let episodes = fillDay(plannedMember, weekday)
    for (const meeting of meetings.filter((item) => item.weekday === weekday)) episodes = overlayMeeting(episodes, meeting)
    return { localDate: dateAt(weekStart, weekday), weekday, episodes }
  })
  return { npcId, name: member.display_name, weekStart, timezone: ZONE, materialized: Boolean(week), profile: member, days }
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
