import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transaction } from './database.mjs'
import { canMeet, mix, mondayOf, planSeedForWeek } from './weekly.mjs'

export const COHORT_KEY = 'nju-jork-100k-v1'
export const PROFILE_VERSION = 'synthetic-week-v1'
const VENUE_KINDS = ['office', 'office', 'cafe', 'grocery', 'restaurant', 'school', 'clinic', 'library', 'community', 'retail']
const CAPACITY = { office: 120, cafe: 48, grocery: 70, restaurant: 70, school: 400,
  clinic: 100, library: 180, community: 180, retail: 70, park_access: 400, station_access: 400 }
const INTERESTS = ['food', 'music', 'reading', 'fitness', 'nature', 'art', 'sports', 'community', 'craft', 'exploring']
const GOALS = ['save_money', 'learn', 'stay_healthy', 'make_friends', 'support_family', 'improve_work', 'explore_city', 'rest_more']
const WORK_KINDS = ['office', 'office', 'retail', 'grocery', 'restaurant', 'cafe', 'clinic', 'community', 'library']

function nearestNode(nodes, x, z) {
  let best = nodes[0]
  let distance = Infinity
  for (const node of nodes) {
    const candidate = (node.x - x) ** 2 + (node.z - z) ** 2
    if (candidate < distance) { best = node; distance = candidate }
  }
  return best
}

function insertPlaces(store, { manifestPath, transitPath }) {
  const buildings = store.db.prepare("SELECT id,zone_id,x,z FROM map_anchor WHERE kind='building' ORDER BY id").all()
  const nodes = store.db.prepare("SELECT id,zone_id,x,z FROM map_anchor WHERE kind='road_node' ORDER BY id").all()
  if (!buildings.length || !nodes.length) throw new Error('The map needs buildings and pedestrian-access nodes')
  const insert = store.db.prepare('INSERT OR IGNORE INTO sim_place(id,anchor_id,zone_id,kind,capacity,provenance,label) VALUES(?,?,?,?,?,?,?)')
  const places = Object.fromEntries([...new Set(VENUE_KINDS), 'park_access', 'station_access'].map((kind) => [kind, []]))
  transaction(store.db, () => {
    for (const [index, building] of buildings.entries()) {
      insert.run(`home:${building.id}`, building.id, building.zone_id, 'home', 1000, 'synthetic', 'Provisional home')
      const kind = VENUE_KINDS[index % VENUE_KINDS.length]
      const place = { id: `${kind}:${building.id}`, anchor_id: building.id, x: building.x, z: building.z, capacity: CAPACITY[kind] }
      insert.run(place.id, building.id, building.zone_id, kind, place.capacity, 'synthetic', `Simulated ${kind.replace('_', ' ')}`)
      places[kind].push(place)
    }
    if (manifestPath) {
      const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'))
      if (Array.isArray(manifest.parkFocus) && manifest.parkFocus.length === 2) {
        const [x, z] = manifest.parkFocus
        const access = nodes.map((node) => ({ node, distance: (node.x - x) ** 2 + (node.z - z) ** 2 }))
          .sort((a, b) => a.distance - b.distance).slice(0, 24)
        for (const { node } of access) {
          const place = { id: `park_access:${node.id}`, anchor_id: node.id, x: node.x, z: node.z, capacity: CAPACITY.park_access }
          insert.run(place.id, node.id, node.zone_id, 'park_access', place.capacity, 'approximate', 'Park access (approximate)')
          places.park_access.push(place)
        }
      }
    }
    if (transitPath) {
      const transit = JSON.parse(readFileSync(resolve(transitPath), 'utf8'))
      for (const zone of Object.values(transit.zones ?? {})) {
        for (const station of zone.nodes?.filter((node) => node.kind === 'station') ?? []) {
          const node = nearestNode(nodes, station.x, station.z)
          const place = { id: `station_access:${station.id}`, anchor_id: node.id, x: node.x, z: node.z, capacity: CAPACITY.station_access }
          insert.run(place.id, node.id, node.zone_id, 'station_access', place.capacity, 'approximate', `Station access near ${station.name}`)
          places.station_access.push(place)
        }
      }
    }
  })
  return { buildings, nodes, places }
}

function choosePlace(list, home, seed, id, salt, occupied = null) {
  if (!list?.length) throw new Error('No simulated places of the required kind')
  let best = null
  let bestDistance = Infinity
  const samples = Math.min(32, list.length)
  for (let step = 0; step < samples; step++) {
    const item = list[mix(seed, id + step, salt) % list.length]
    if (occupied && (occupied.get(item.id) ?? 0) >= item.capacity) continue
    const distance = (item.x - home.x) ** 2 + (item.z - home.z) ** 2
    if (distance < bestDistance || (distance === bestDistance && item.id < best.id)) {
      best = item; bestDistance = distance
    }
  }
  if (!best && occupied) {
    best = list.find((item) => (occupied.get(item.id) ?? 0) < item.capacity)
  }
  if (!best) throw new Error('No simulated place has remaining assignment capacity')
  if (occupied) occupied.set(best.id, (occupied.get(best.id) ?? 0) + 1)
  return best
}

function profileFor(npc, home, places, seed, occupied) {
  const id = npc.id
  const profileSeed = mix(seed, id, 0x501)
  const age = 2026 - npc.birth_year
  const lifeStage = age < 13 ? 'child' : age < 18 ? 'teen' : age >= 65 ? 'older_adult' : 'adult'
  const chronotype = ['early', 'day', 'late'][mix(seed, id, 0x502) % 3]
  const mobility = ['walk', 'transit', 'transit', 'mixed', 'car'][mix(seed, id, 0x503) % 5]
  const socialStyle = ['quiet', 'balanced', 'outgoing'][mix(seed, id, 0x504) % 3]
  const interest = INTERESTS[mix(seed, id, 0x505) % INTERESTS.length]
  const goal = GOALS[mix(seed, id, 0x506) % GOALS.length]
  const occupation = npc.role === 'student' ? 'student'
    : npc.role === 'worker' ? WORK_KINDS[mix(seed, id, 0x507) % WORK_KINDS.length]
      : age >= 65 ? 'retired' : 'home_or_care'
  const shiftPattern = npc.role === 'student' ? 'school' : npc.role === 'other' ? 'none'
    : ['weekday', 'weekday', 'staggered', 'weekend', 'four_day'][mix(seed, id, 0x508) % 5]
  const work = npc.role === 'student'
    ? choosePlace(places.school, home, seed, id, 0x509, occupied)
    : npc.role === 'worker' ? choosePlace(places[occupation], home, seed, id, 0x50a, occupied) : null
  const cafe = choosePlace(places.cafe, home, seed, id, 0x50b)
  const errand = choosePlace(places.grocery, home, seed, id, 0x50c)
  const leisureCandidates = places.park_access.length && mix(seed, id, 0x50d) % 3 === 0
    ? places.park_access : places.library.length ? places.library : places.community
  const leisure = choosePlace(leisureCandidates, home, seed, id, 0x50e)
  const distanceMetres = work ? Math.hypot(home.x - work.x, home.z - work.z) * 3 : 0
  const assumedMetresPerMinute = mobility === 'walk' ? 68 : mobility === 'car' ? 200 : 150
  const commuteMinute = work ? Math.min(100, Math.max(12, Math.ceil(distanceMetres / assumedMetresPerMinute) + 10)) : 0
  return { profileSeed, lifeStage, occupation, shiftPattern, chronotype, mobility, socialStyle, interest, goal,
    homePlaceId: `home:${home.id}`, workPlaceId: work?.id ?? null, workAnchorId: work?.anchor_id ?? null,
    cafePlaceId: cafe.id, errandPlaceId: errand.id, leisurePlaceId: leisure.id, commuteMinute,
    planSeed: mix(seed, id, 0x50f) }
}

function insertPair(statement, a, b, kind, strength) {
  if (a === b) return
  statement.run(Math.min(a, b), Math.max(a, b), kind, strength, 'synthetic')
}

export function makeRelations(store) {
  const rows = store.db.prepare(`SELECT m.npc_id,n.household_id,m.home_place_id,m.work_place_id,a.x,a.z
    FROM sim_member m JOIN npc n ON n.id=m.npc_id JOIN household h ON h.id=n.household_id
    JOIN map_anchor a ON a.id=h.home_anchor_id WHERE m.cohort_key=? ORDER BY m.npc_id`).all(COHORT_KEY)
  const insert = store.db.prepare('INSERT OR IGNORE INTO sim_relationship(npc_a_id,npc_b_id,kind,strength,provenance) VALUES(?,?,?,?,?)')
  const byHousehold = new Map(), byHome = new Map(), byWork = new Map()
  for (const row of rows) {
    for (const [map, key] of [[byHousehold, row.household_id], [byHome, row.home_place_id], [byWork, row.work_place_id]]) {
      if (key === null) continue
      const group = map.get(key) ?? []
      group.push(row.npc_id)
      map.set(key, group)
    }
  }
  transaction(store.db, () => {
    for (const group of byHousehold.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      insertPair(insert, group[i], group[j], 'family', 70)
    }
    for (const group of byHome.values()) for (let i = 1; i < group.length; i++) insertPair(insert, group[i - 1], group[i], 'neighbor', 30)
    for (const group of byWork.values()) for (let i = 1; i < group.length; i++) insertPair(insert, group[i - 1], group[i], 'coworker', 35)
    const friendOrder = [...rows].sort((a, b) => {
      const cellA = `${Math.floor(a.x / 160)}:${Math.floor(a.z / 160)}`
      const cellB = `${Math.floor(b.x / 160)}:${Math.floor(b.z / 160)}`
      return cellA.localeCompare(cellB) || mix(1930, a.npc_id, 0x600) - mix(1930, b.npc_id, 0x600) || a.npc_id - b.npc_id
    })
    for (let i = 1; i < friendOrder.length; i += 2) insertPair(insert, friendOrder[i - 1].npc_id, friendOrder[i].npc_id, 'friend', 55)
  })
}

function chooseMeeting(a, b, place, weekStart, occupancy) {
  const salt = mix(a.plan_seed, b.npc_id, Number(weekStart.replaceAll('-', '')))
  const slots = [12, 13, 14, 15, 16, 17, 18, 19].map((hour) => hour * 60)
  for (let index = 0; index < 7 * slots.length; index++) {
    const day = (Math.floor(index / slots.length) + salt % 7) % 7
    const minute = slots[(index + (salt >>> 8)) % slots.length]
    if (!canMeet(a, day, minute, 60) || !canMeet(b, day, minute, 60)) continue
    const key = `${place.id}:${day}:${minute}`
    if ((occupancy.get(key) ?? 0) + 2 > place.capacity) continue
    occupancy.set(key, (occupancy.get(key) ?? 0) + 2)
    return { id: `meet:${weekStart}:${a.npc_id}:${b.npc_id}`, day, minute }
  }
  return null
}

export function materializeWeek(store, weekStart) {
  if (mondayOf(weekStart) !== weekStart) throw new RangeError('weekStart must be a Monday')
  const cohort = store.db.prepare('SELECT * FROM sim_cohort WHERE cohort_key=?').get(COHORT_KEY)
  if (!cohort || cohort.generated_count !== cohort.target_count) throw new Error('Complete the cohort before generating a week')
  const members = store.db.prepare('SELECT * FROM sim_member WHERE cohort_key=? ORDER BY npc_id').all(COHORT_KEY)
  const insertWeek = store.db.prepare('INSERT OR IGNORE INTO sim_week(npc_id,week_start,plan_seed,plan_version) VALUES(?,?,?,?)')
  for (let start = 0; start < members.length; start += 2000) transaction(store.db, () => {
    for (const member of members.slice(start, start + 2000)) insertWeek.run(member.npc_id, weekStart,
      weekStart === cohort.week_start ? member.plan_seed : planSeedForWeek(member.plan_seed, weekStart), PROFILE_VERSION)
  })
  const memberById = new Map(members.map((member) => [member.npc_id, member]))
  const placeById = new Map(store.db.prepare("SELECT id,capacity FROM sim_place WHERE kind='cafe'").all().map((place) => [place.id, place]))
  const existing = store.db.prepare('SELECT place_id,weekday,start_minute,COUNT(*) AS n FROM sim_meeting WHERE week_start=? AND status=? GROUP BY place_id,weekday,start_minute').all(weekStart, 'planned')
  const occupancy = new Map(existing.map((row) => [`${row.place_id}:${row.weekday}:${row.start_minute}`, row.n * 2]))
  const friends = store.db.prepare("SELECT npc_a_id,npc_b_id FROM sim_relationship WHERE kind='friend' ORDER BY npc_a_id,npc_b_id").all()
  const insertMeeting = store.db.prepare('INSERT OR IGNORE INTO sim_meeting(id,week_start,npc_a_id,npc_b_id,place_id,weekday,start_minute,duration_minute) VALUES(?,?,?,?,?,?,?,?)')
  const hasMeeting = store.db.prepare('SELECT 1 FROM sim_meeting WHERE id=?')
  for (let start = 0; start < friends.length; start += 1000) transaction(store.db, () => {
    for (const pair of friends.slice(start, start + 1000)) {
      const a = memberById.get(pair.npc_a_id), b = memberById.get(pair.npc_b_id)
      const id = `meet:${weekStart}:${a.npc_id}:${b.npc_id}`
      if (hasMeeting.get(id)) continue
      const place = placeById.get(a.cafe_place_id)
      const slot = chooseMeeting(a, b, place, weekStart, occupancy)
      if (slot) insertMeeting.run(slot.id, weekStart, a.npc_id, b.npc_id, place.id, slot.day, slot.minute, 60)
    }
  })
  return { weekStart, plans: store.db.prepare('SELECT COUNT(*) AS n FROM sim_week WHERE week_start=?').get(weekStart).n,
    meetings: store.db.prepare('SELECT COUNT(*) AS n FROM sim_meeting WHERE week_start=?').get(weekStart).n }
}

export function seedWeeklyPopulation(store, { count = 100000, seed = 1930, weekStart,
  manifestPath = 'public/assets/nju-jork/manifest.json', transitPath = 'public/assets/nju-jork/transit-network.json',
  onBatch = () => {} } = {}) {
  if (!Number.isSafeInteger(count) || count < 2 || count > 100000) throw new RangeError('count must be 2..100000')
  if (!Number.isSafeInteger(seed) || seed < 0) throw new RangeError('seed must be a nonnegative integer')
  if (mondayOf(weekStart) !== weekStart) throw new RangeError('weekStart must be a Monday')
  const mapHash = store.getMeta('map_hash')
  if (!mapHash) throw new Error('The map anchors must be imported first')
  const sourceVersion = store.getMeta('source_data_version') ?? 'unknown'
  const proofWorkerId = Number(store.getMeta('npc_proof_worker_id') ?? 0)
  const existing = store.db.prepare('SELECT * FROM sim_cohort WHERE cohort_key=?').get(COHORT_KEY)
  if (existing && (existing.target_count !== count || existing.seed !== seed || existing.generator_version !== PROFILE_VERSION ||
    existing.map_hash !== mapHash || existing.source_version !== sourceVersion)) {
    throw new Error('Cohort settings or source data changed; use an explicit migration')
  }
  const candidates = store.db.prepare(`SELECT n.id,n.household_id,n.birth_year,n.role,h.home_anchor_id
    FROM npc n JOIN household h ON h.id=n.household_id
    WHERE n.home_zone_id <> 'off_map' AND n.id<>?
      AND NOT EXISTS (SELECT 1 FROM npc_assignment a WHERE a.npc_id=n.id AND a.provenance='verified')
    ORDER BY n.id`).all(proofWorkerId)
  if (candidates.length < count) throw new Error(`Only ${candidates.length} mapped candidates exist for ${count} members`)
  const selected = candidates.sort((a, b) => mix(seed, a.id, 0x401) - mix(seed, b.id, 0x401) || a.id - b.id)
    .slice(0, count).sort((a, b) => a.id - b.id)
  const { buildings, places } = insertPlaces(store, { manifestPath, transitPath })
  const homeById = new Map(buildings.map((building) => [building.id, building]))
  const occupied = new Map()
  const insertCohort = store.db.prepare(`INSERT OR IGNORE INTO sim_cohort
    (cohort_key,target_count,seed,generator_version,map_hash,source_version,timezone,week_start,generated_count)
    VALUES(?,?,?,?,?,?,?,?,0)`)
  insertCohort.run(COHORT_KEY, count, seed, PROFILE_VERSION, mapHash, sourceVersion, 'America/New_York', weekStart)
  const insertMember = store.db.prepare(`INSERT OR IGNORE INTO sim_member
    (npc_id,cohort_key,profile_seed,life_stage,occupation,shift_pattern,chronotype,mobility,social_style,interest,goal,
     home_place_id,work_place_id,cafe_place_id,errand_place_id,leisure_place_id,commute_minute,plan_seed,profile_version)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const current = store.db.prepare('SELECT npc_id,work_place_id FROM sim_member WHERE cohort_key=?').all(COHORT_KEY)
  const currentIds = new Set(current.map((row) => row.npc_id))
  for (const row of current) if (row.work_place_id) occupied.set(row.work_place_id, (occupied.get(row.work_place_id) ?? 0) + 1)
  for (let start = 0; start < selected.length; start += 2000) {
    const chunk = selected.slice(start, start + 2000)
    transaction(store.db, () => {
      for (const npc of chunk) {
        if (currentIds.has(npc.id)) continue
        const home = homeById.get(npc.home_anchor_id)
        if (!home) throw new Error(`Missing home building for NPC ${npc.id}`)
        const profile = profileFor(npc, home, places, seed, occupied)
        insertMember.run(npc.id, COHORT_KEY, profile.profileSeed, profile.lifeStage, profile.occupation, profile.shiftPattern,
          profile.chronotype, profile.mobility, profile.socialStyle, profile.interest, profile.goal, profile.homePlaceId,
          profile.workPlaceId, profile.cafePlaceId, profile.errandPlaceId, profile.leisurePlaceId,
          profile.commuteMinute, profile.planSeed, PROFILE_VERSION)
        if (profile.workAnchorId) store.setAssignment({ npcId: npc.id, kind: npc.role === 'student' ? 'school' : 'work',
          anchorId: profile.workAnchorId, scheduleCode: `sim_${profile.shiftPattern}`, provenance: 'synthetic' })
      }
      store.db.prepare('UPDATE sim_cohort SET generated_count=(SELECT COUNT(*) FROM sim_member WHERE cohort_key=?) WHERE cohort_key=?')
        .run(COHORT_KEY, COHORT_KEY)
    })
    onBatch({ generated: Math.min(start + chunk.length, selected.length), target: selected.length })
  }
  makeRelations(store)
  const week = materializeWeek(store, weekStart)
  return { count: store.db.prepare('SELECT COUNT(*) AS n FROM sim_member WHERE cohort_key=?').get(COHORT_KEY).n,
    places: store.db.prepare('SELECT COUNT(*) AS n FROM sim_place').get().n,
    relationships: store.db.prepare('SELECT COUNT(*) AS n FROM sim_relationship').get().n, ...week }
}
