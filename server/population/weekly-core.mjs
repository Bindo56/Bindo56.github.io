import { CROWD_SITES } from './crowd-sites.mjs'

export const ZONE = 'America/New_York'
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

export function attractionCandidate(npcId) { return mix(npcId, 0, 0x174) % 5 === 0 }

export function attractionSiteIndex(planSeed, weekday) {
  return mix(planSeed, weekday, 0x9a4) % CROWD_SITES.length
}

export function dateAt(localDate, days) {
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

export function fillDay(member, weekday) {
  const work = workWindow(member, weekday)
  const bedtime = member.chronotype === 'early' ? 21 * 60 + 30 : member.chronotype === 'late' ? 23 * 60 + 45 : 23 * 60
  const defaultWake = member.chronotype === 'early' ? 5 * 60 : member.chronotype === 'late' ? 9 * 60 : 7 * 60
  const wake = work ? Math.min(defaultWake, work.start - member.commute_minute - 45) : defaultWake
  const items = [segment(0, wake, 'sleep', member.home_place_id, 'Regular rest')]
  if (work) {
    const depart = work.start - member.commute_minute
    items.push(segment(depart, work.start, 'commute_to_work', member.work_place_id, 'Scheduled shift'))
    const breakStart = Math.max(work.start + 90, Math.min(work.end - 60,
      Math.round((work.start + work.end) / 2) - 15 + (mix(member.plan_seed, weekday, 0xb18) % 91) - 45))
    const outdoorBreak = mix(member.plan_seed, weekday, 0xb47) % 2 === 0
    items.push(segment(work.start, breakStart, member.shift_pattern === 'school' ? 'school' : 'work', member.work_place_id, 'Scheduled commitment'))
    items.push(segment(breakStart, breakStart + 30, outdoorBreak ? 'outdoor_break' : 'meal_break',
      outdoorBreak ? member.cafe_place_id : member.work_place_id, 'Mid-shift break'))
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
  const visitDuration = 90 + mix(member.plan_seed, weekday, 0x68f) % 31
  const visitWindows = attractionCandidate(member.npc_id) ? complete.filter((item) =>
    item.activity === 'home' && Math.min(item.endMinute - 15, 22 * 60)
      - Math.max(item.startMinute + 15, 9 * 60) >= visitDuration) : []
  const visitWindow = visitWindows.length
    ? visitWindows[mix(member.plan_seed, weekday, 0x40a) % visitWindows.length] : null
  const withVisit = []
  for (const item of complete) {
    if (item !== visitWindow) { withVisit.push(item); continue }
    const earliest = Math.max(item.startMinute + 15, 9 * 60)
    const latest = Math.min(item.endMinute - 15, 22 * 60) - visitDuration
    const start = earliest + mix(member.plan_seed, weekday, 0x5bd) % (latest - earliest + 1)
    const site = CROWD_SITES[attractionSiteIndex(member.plan_seed, weekday)]
    if (item.startMinute < start) withVisit.push({ ...item, endMinute: start })
    withVisit.push(segment(start, start + visitDuration, 'tourist_visit', site.placeId,
      `Visiting ${site.label}`))
    if (start + visitDuration < item.endMinute) withVisit.push({ ...item, startMinute: start + visitDuration })
  }
  const withWalks = []
  for (const item of withVisit) {
    const duration = 30 + mix(member.plan_seed, weekday, item.startMinute ^ 0x51a) % 21
    const earliest = Math.max(item.startMinute + 15, 8 * 60)
    const latest = Math.min(item.endMinute - 15, bedtime - 20)
    if (item.activity !== 'home' || latest - earliest < duration
      || mix(member.plan_seed, weekday, item.startMinute ^ 0x72d) % 3 === 0) {
      withWalks.push(item)
      continue
    }
    const start = earliest + mix(member.plan_seed, weekday, item.startMinute ^ 0x1fa)
      % (latest - earliest - duration + 1)
    if (item.startMinute < start) withWalks.push({ ...item, endMinute: start })
    withWalks.push(segment(start, start + duration, 'street_stroll', member.leisure_place_id,
      'A walk through the neighborhood'))
    if (start + duration < item.endMinute) withWalks.push({ ...item, startMinute: start + duration })
  }
  return withWalks
}

export function overlayMeeting(day, meeting) {
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

/** The same deterministic weekly plan for SQLite callers and the browser worker. */
export function generateWeek(member, meetings, weekStart, materialized = false, planSeed = null) {
  if (mondayOf(weekStart) !== weekStart) throw new RangeError('weekStart must be a Monday in YYYY-MM-DD form')
  const plannedMember = { ...member, plan_seed: planSeed ?? planSeedForWeek(member.plan_seed, weekStart) }
  const days = Array.from({ length: 7 }, (_, weekday) => {
    let episodes = fillDay(plannedMember, weekday)
    for (const meeting of meetings.filter((item) => item.weekday === weekday)) episodes = overlayMeeting(episodes, meeting)
    return { localDate: dateAt(weekStart, weekday), weekday, episodes }
  })
  return { npcId: member.npc_id, name: member.display_name, weekStart, timezone: ZONE,
    materialized, profile: member, days }
}
