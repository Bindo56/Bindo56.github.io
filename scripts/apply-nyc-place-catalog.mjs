import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_DATABASE_PATH, openPopulationDatabase, transaction } from '../server/population/database.mjs'
import { auditWeeklyPopulation } from '../server/population/audit-weekly.mjs'
import { COHORT_KEY, makeRelations, materializeWeek } from '../server/population/seed-weekly.mjs'
import { mix } from '../server/population/weekly.mjs'

const root = resolve(import.meta.dirname, '..')
const path = resolve(process.argv.find((arg) => arg.startsWith('--db='))?.slice(5) ?? DEFAULT_DATABASE_PATH)
const catalogPath = resolve(root, 'public/assets/nju-jork/place-catalog.json')
const bytes = readFileSync(catalogPath)
const catalog = JSON.parse(bytes)
const hash = createHash('sha256').update(bytes).digest('hex')
const store = openPopulationDatabase(path, { create: false })

function capacity(kind, building) {
  if (kind === 'home') return Math.max(4, Math.min(1000, building.unitsRes || 20))
  return Math.max(80, Math.min(2500, Math.ceil(building.officeAreaSqFt / 180)))
}

function sourceFor(building, kind) {
  const pluto = building.sources.find((source) => source.dataset.startsWith('NYC PLUTO') &&
    source.match === 'address_and_footprint')
  return pluto ?? building.sources.find((source) => source.dataset === 'OSM building') ?? {
    dataset: 'OpenStreetMap', id: building.id, match: 'building_tag', distanceM: null,
  }
}

function nearestPlace(list, home, seed, id, salt, occupied = null) {
  let best = null
  let bestDistance = Infinity
  const samples = Math.min(64, list.length)
  for (let i = 0; i < samples; i++) {
    const item = list[mix(seed, id + i, salt) % list.length]
    if (occupied && (occupied.get(item.id) ?? 0) >= item.capacity) continue
    const distance = (item.x - home.x) ** 2 + (item.z - home.z) ** 2
    if (distance < bestDistance || (distance === bestDistance && item.id < best.id)) {
      best = item
      bestDistance = distance
    }
  }
  if (!best) best = list.find((item) => !occupied || (occupied.get(item.id) ?? 0) < item.capacity)
  if (!best) throw new Error('Real place capacity exhausted')
  if (occupied) occupied.set(best.id, (occupied.get(best.id) ?? 0) + 1)
  return best
}

try {
  if (catalog.version !== 1 || catalog.coverage.buildingAnchors !== 4026) throw new Error('Unexpected place catalog')
  const existing = store.getMeta('nyc_place_catalog_sha256')
  if (existing === hash) {
    console.log(JSON.stringify({ status: 'already_applied', catalogHash: hash }))
    process.exit(0)
  }
  if (existing) throw new Error('A different catalog is applied; restore a backup before remapping')
  const db = store.db
  const cohort = db.prepare('SELECT * FROM sim_cohort WHERE cohort_key=?').get(COHORT_KEY)
  if (!cohort || cohort.generated_count !== 100000) throw new Error('The 100,000 member cohort must exist first')
  if (db.prepare("SELECT COUNT(*) n FROM sim_meeting WHERE status<>'planned'").get().n ||
      db.prepare('SELECT COUNT(*) n FROM sim_interaction').get().n) {
    throw new Error('Recorded meetings or interactions exist; review them before remapping places')
  }
  const anchors = db.prepare("SELECT id,zone_id,x,z FROM map_anchor WHERE kind='building'").all()
  const byAnchor = new Map(anchors.map((anchor) => [anchor.id, anchor]))
  if (byAnchor.size !== catalog.buildings.length || catalog.buildings.some((building) => !byAnchor.has(building.id))) {
    throw new Error('Catalog does not match database map anchors')
  }
  const placeLists = new Map()
  const addCandidate = (place) => {
    const list = placeLists.get(place.kind) ?? []
    list.push(place)
    placeLists.set(place.kind, list)
  }
  const insertBuilding = db.prepare(`INSERT INTO map_building_use
    (anchor_id,uses_json,residential_units,office_area_sqft,retail_area_sqft,bbls_json,sources_json)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(anchor_id) DO UPDATE SET
    uses_json=excluded.uses_json,residential_units=excluded.residential_units,
    office_area_sqft=excluded.office_area_sqft,retail_area_sqft=excluded.retail_area_sqft,
    bbls_json=excluded.bbls_json,sources_json=excluded.sources_json`)
  const upsertPlace = db.prepare(`INSERT INTO sim_place(id,anchor_id,zone_id,kind,capacity,provenance,label,active)
    VALUES(?,?,?,?,?,'approximate',?,1) ON CONFLICT(id) DO UPDATE SET
    anchor_id=excluded.anchor_id,zone_id=excluded.zone_id,kind=excluded.kind,
    capacity=excluded.capacity,provenance=excluded.provenance,label=excluded.label,active=1`)
  const upsertSource = db.prepare(`INSERT INTO sim_place_source(place_id,dataset,source_id,match_method,distance_m,fetched_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(place_id) DO UPDATE SET
    dataset=excluded.dataset,source_id=excluded.source_id,match_method=excluded.match_method,
    distance_m=excluded.distance_m,fetched_at=excluded.fetched_at`)
  const householdRows = db.prepare(`SELECT DISTINCT h.id,h.home_anchor_id,a.x,a.z
    FROM sim_member m JOIN npc n ON n.id=m.npc_id JOIN household h ON h.id=n.household_id
    JOIN map_anchor a ON a.id=h.home_anchor_id WHERE m.cohort_key=? ORDER BY h.id`).all(COHORT_KEY)
  const memberRows = db.prepare(`SELECT m.npc_id,n.household_id,n.role,m.occupation,m.mobility,m.shift_pattern
    FROM sim_member m JOIN npc n ON n.id=m.npc_id WHERE m.cohort_key=? ORDER BY m.npc_id`).all(COHORT_KEY)
  const homeOccupancy = new Map()
  const workOccupancy = new Map()
  const householdHomes = new Map()
  const nearestHomes = new Map()
  const upsertHousehold = db.prepare(`INSERT INTO sim_household_home(household_id,anchor_id) VALUES(?,?)
    ON CONFLICT(household_id) DO UPDATE SET anchor_id=excluded.anchor_id`)
  const updateMember = db.prepare(`UPDATE sim_member SET home_place_id=?,work_place_id=?,cafe_place_id=?,
    errand_place_id=?,leisure_place_id=?,commute_minute=? WHERE npc_id=?`)
  const upsertAssignment = db.prepare(`INSERT INTO npc_assignment(npc_id,kind,anchor_id,schedule_code,provenance)
    VALUES(?,?,?,?,'synthetic') ON CONFLICT(npc_id,kind) DO UPDATE SET
    anchor_id=excluded.anchor_id,schedule_code=excluded.schedule_code,provenance=excluded.provenance`)

  transaction(db, () => {
    db.prepare("UPDATE sim_place SET active=0 WHERE provenance='synthetic'").run()
    for (const building of catalog.buildings) {
      insertBuilding.run(building.id, JSON.stringify(building.uses), building.unitsRes,
        building.officeAreaSqFt, building.retailAreaSqFt, JSON.stringify(building.bbls), JSON.stringify(building.sources))
      const anchor = byAnchor.get(building.id)
      for (const kind of ['home', 'office']) {
        if (!building.uses.includes(kind)) continue
        const id = `${kind}:${building.id}`
        const cap = capacity(kind, building)
        const label = kind === 'home' ? `Residential building: ${building.address || building.name}`
          : `Office building: ${building.address || building.name}`
        upsertPlace.run(id, building.id, anchor.zone_id, kind, cap, label)
        const source = sourceFor(building, kind)
        upsertSource.run(id, source.dataset, source.id, source.match ?? 'building_tag', source.distanceM ?? null,
          source.dataset.startsWith('NYC PLUTO') ? catalog.fetchedAt.pluto : catalog.fetchedAt.osm)
        addCandidate({ id, anchorId: building.id, kind, x: anchor.x, z: anchor.z, capacity: cap })
      }
    }
    for (const place of catalog.places) {
      const anchor = byAnchor.get(place.anchorId)
      if (!anchor) throw new Error(`Unknown place anchor ${place.anchorId}`)
      const id = `mapped:${place.id}`
      const cap = { office: 120, cafe: 48, grocery: 80, restaurant: 80, school: 500,
        clinic: 120, library: 200, community: 200, retail: 80 }[place.kind]
      if (!cap) continue
      upsertPlace.run(id, place.anchorId, anchor.zone_id, place.kind, cap, place.label)
      upsertSource.run(id, place.source, place.sourceId, place.match, place.distanceM,
        place.source === 'NYC DOHMH' ? catalog.fetchedAt.restaurants : catalog.fetchedAt.osm)
      addCandidate({ id, anchorId: place.anchorId, kind: place.kind, x: anchor.x, z: anchor.z, capacity: cap })
    }
    const homes = placeLists.get('home') ?? []
    if (!homes.length) throw new Error('No residential buildings mapped')
    for (const household of householdRows) {
      let sorted = nearestHomes.get(household.home_anchor_id)
      if (!sorted) {
        sorted = [...homes].sort((a, b) =>
          (a.x - household.x) ** 2 + (a.z - household.z) ** 2 -
          ((b.x - household.x) ** 2 + (b.z - household.z) ** 2) || a.id.localeCompare(b.id))
        nearestHomes.set(household.home_anchor_id, sorted)
      }
      const home = sorted.find((item) => (homeOccupancy.get(item.id) ?? 0) < item.capacity)
      if (!home) throw new Error('Residential capacity exhausted')
      homeOccupancy.set(home.id, (homeOccupancy.get(home.id) ?? 0) + 1)
      householdHomes.set(household.id, home)
      upsertHousehold.run(household.id, home.anchorId)
    }
    for (const member of memberRows) {
      const home = householdHomes.get(member.household_id)
      const occupation = member.role === 'student' ? 'school' : member.role === 'worker' ? member.occupation : null
      const work = occupation ? nearestPlace(placeLists.get(occupation) ?? [], home, 1930, member.npc_id, 0x50a, workOccupancy) : null
      const cafe = nearestPlace(placeLists.get('cafe') ?? [], home, 1930, member.npc_id, 0x50b)
      const errand = nearestPlace(placeLists.get('grocery') ?? [], home, 1930, member.npc_id, 0x50c)
      const leisureKind = mix(1930, member.npc_id, 0x50d) % 3 === 0 ? 'community' : 'library'
      const leisure = nearestPlace(placeLists.get(leisureKind) ?? [], home, 1930, member.npc_id, 0x50e)
      const distanceMetres = work ? Math.hypot(home.x - work.x, home.z - work.z) * 3 : 0
      const speed = member.mobility === 'walk' ? 68 : member.mobility === 'car' ? 200 : 150
      const commute = work ? Math.min(100, Math.max(12, Math.ceil(distanceMetres / speed) + 10)) : 0
      updateMember.run(home.id, work?.id ?? null, cafe.id, errand.id, leisure.id, commute, member.npc_id)
      if (work) upsertAssignment.run(member.npc_id, member.role === 'student' ? 'school' : 'work',
        work.anchorId, `sim_${member.shift_pattern}`)
    }
    db.prepare("DELETE FROM sim_relationship WHERE kind IN ('neighbor','coworker') AND provenance='synthetic'").run()
    db.prepare("DELETE FROM sim_meeting WHERE status='planned'").run()
  })
  makeRelations(store)
  const weeks = db.prepare('SELECT DISTINCT week_start FROM sim_week ORDER BY week_start').all().map((row) => row.week_start)
  for (const week of weeks) {
    const result = materializeWeek(store, week)
    const audit = auditWeeklyPopulation(store, { weekStart: week, sampleCount: 200 })
    if (!audit.ok) throw new Error(`Audit failed for ${week}: ${audit.errors.join('; ')}`)
    console.log(JSON.stringify({ week, ...result, audit: 'passed' }))
  }
  store.setMeta('nyc_place_catalog_sha256', hash)
  console.log(JSON.stringify({ status: 'applied', catalogHash: hash, buildings: catalog.buildings.length,
    mappedPlaces: catalog.places.length, households: householdRows.length, members: memberRows.length,
    activePlaces: db.prepare('SELECT COUNT(*) n FROM sim_place WHERE active=1').get().n }))
} finally {
  store.close()
}
