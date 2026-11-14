import { COHORT_KEY } from './seed-weekly.mjs'
import { canMeet, getWeek } from './weekly.mjs'

export function auditWeeklyPopulation(store, { expectedCount = 100000, weekStart, sampleCount = 200 } = {}) {
  const db = store.db
  const cohort = db.prepare('SELECT * FROM sim_cohort WHERE cohort_key=?').get(COHORT_KEY)
  if (!cohort) return { ok: false, errors: ['Cohort is missing'] }
  const week = weekStart ?? cohort.week_start
  const errors = []
  const count = db.prepare('SELECT COUNT(*) AS n FROM sim_member WHERE cohort_key=?').get(COHORT_KEY).n
  if (count !== expectedCount || cohort.generated_count !== count) errors.push(`Expected ${expectedCount} members; found ${count}`)
  const missingWeek = db.prepare(`SELECT COUNT(*) AS n FROM sim_member m LEFT JOIN sim_week w ON w.npc_id=m.npc_id AND w.week_start=?
    WHERE m.cohort_key=? AND w.npc_id IS NULL`).get(week, COHORT_KEY).n
  if (missingWeek) errors.push(`${missingWeek} members have no week header`)
  const badHome = db.prepare(`SELECT COUNT(*) AS n FROM sim_member m JOIN npc n ON n.id=m.npc_id
    JOIN household h ON h.id=n.household_id JOIN sim_place p ON p.id=m.home_place_id
    LEFT JOIN sim_household_home sh ON sh.household_id=h.id
    WHERE m.cohort_key=? AND (p.kind<>'home' OR p.anchor_id<>COALESCE(sh.anchor_id,h.home_anchor_id))`).get(COHORT_KEY).n
  if (badHome) errors.push(`${badHome} home assignments do not match households`)
  const badWork = db.prepare(`SELECT COUNT(*) AS n FROM sim_member m JOIN npc n ON n.id=m.npc_id
    LEFT JOIN sim_place p ON p.id=m.work_place_id
    LEFT JOIN npc_assignment a ON a.npc_id=m.npc_id AND a.kind=CASE WHEN n.role='student' THEN 'school' ELSE 'work' END
    WHERE m.cohort_key=? AND ((n.role IN ('worker','student') AND
      (p.id IS NULL OR a.anchor_id<>p.anchor_id OR a.provenance<>'synthetic')) OR
      (n.role='other' AND m.work_place_id IS NOT NULL))`).get(COHORT_KEY).n
  if (badWork) errors.push(`${badWork} work or school assignments are inconsistent`)
  const overStaffed = db.prepare(`SELECT COUNT(*) AS n FROM (
    SELECT p.id FROM sim_place p JOIN sim_member m ON m.work_place_id=p.id
    GROUP BY p.id HAVING COUNT(*)>p.capacity)`).get().n
  if (overStaffed) errors.push(`${overStaffed} workplaces exceed staff capacity`)
  const overMeetings = db.prepare(`SELECT COUNT(*) AS n FROM (
    SELECT p.id FROM sim_meeting g JOIN sim_place p ON p.id=g.place_id
    WHERE g.week_start=? AND g.status='planned'
    GROUP BY g.place_id,g.weekday,g.start_minute HAVING COUNT(*)*2>p.capacity)`).get(week).n
  if (overMeetings) errors.push(`${overMeetings} meeting slots exceed place capacity`)
  const invalidMeetings = db.prepare(`SELECT g.*, a.shift_pattern AS a_shift_pattern,a.work_place_id AS a_work_place_id,
    a.chronotype AS a_chronotype,a.commute_minute AS a_commute_minute,
    b.shift_pattern AS b_shift_pattern,b.work_place_id AS b_work_place_id,
    b.chronotype AS b_chronotype,b.commute_minute AS b_commute_minute
    FROM sim_meeting g JOIN sim_member a ON a.npc_id=g.npc_a_id JOIN sim_member b ON b.npc_id=g.npc_b_id
    WHERE g.week_start=? AND g.status='planned'`).all(week).filter((meeting) => {
    const a = { shift_pattern: meeting.a_shift_pattern, work_place_id: meeting.a_work_place_id,
      chronotype: meeting.a_chronotype, commute_minute: meeting.a_commute_minute }
    const b = { shift_pattern: meeting.b_shift_pattern, work_place_id: meeting.b_work_place_id,
      chronotype: meeting.b_chronotype, commute_minute: meeting.b_commute_minute }
    return !canMeet(a, meeting.weekday, meeting.start_minute, meeting.duration_minute) ||
      !canMeet(b, meeting.weekday, meeting.start_minute, meeting.duration_minute)
  }).length
  if (invalidMeetings) errors.push(`${invalidMeetings} meetings conflict with shifts or travel`)
  const rows = db.prepare('SELECT npc_id FROM sim_member WHERE cohort_key=? ORDER BY npc_id').all(COHORT_KEY)
  const stride = Math.max(1, Math.floor(rows.length / Math.max(1, sampleCount)))
  let sampled = 0
  for (let index = 0; index < rows.length; index += stride) {
    const plan = getWeek(store, rows[index].npc_id, week)
    sampled++
    for (const day of plan.days) {
      if (day.episodes[0]?.startMinute !== 0 || day.episodes.at(-1)?.endMinute !== 1440 ||
          day.episodes.some((episode, position) => episode.endMinute <= episode.startMinute ||
            (position > 0 && day.episodes[position - 1].endMinute !== episode.startMinute))) {
        errors.push(`NPC ${rows[index].npc_id} has a gap or overlap on ${day.localDate}`)
        break
      }
    }
  }
  const integrity = store.integrity()
  if (!integrity.ok) errors.push('SQLite integrity or foreign-key check failed')
  return { ok: errors.length === 0, errors, cohort: COHORT_KEY, weekStart: week, count, missingWeek,
    badHome, badWork, overStaffed, overMeetings, invalidMeetings, sampled, integrity: integrity.ok }
}
