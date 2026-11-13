import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { transaction } from './database.mjs'

export const GENERATOR_VERSION = 'synthetic-v1'
export const SOURCE_DATA_VERSION = 'synthetic-placeholder-v1'
export const OFF_MAP_ANCHOR = 'OFFMAP:NYC'

const firstNames = [
  'Aanya', 'Aaron', 'Ada', 'Adrian', 'Aisha', 'Alex', 'Amara', 'Amir',
  'Ana', 'Andre', 'Anika', 'Arjun', 'Ava', 'Ben', 'Camila', 'Carlos',
  'Chloe', 'Daniel', 'David', 'Diana', 'Eli', 'Elena', 'Emily', 'Emma',
  'Ethan', 'Fatima', 'Grace', 'Hannah', 'Harper', 'Ibrahim', 'Isaac', 'Isabel',
  'Jack', 'Jamal', 'Jasmine', 'Jay', 'Jordan', 'Jose', 'Julia', 'Kai',
  'Leah', 'Leo', 'Liam', 'Lina', 'Lucas', 'Maya', 'Mia', 'Mira',
  'Nadia', 'Noah', 'Olivia', 'Omar', 'Priya', 'Rafael', 'Rina', 'Sam',
  'Sara', 'Sofia', 'Theo', 'Victor', 'Yara', 'Yuki', 'Zara', 'Zoe',
]
const lastNames = [
  'Ali', 'Alvarez', 'Anderson', 'Baker', 'Banerjee', 'Bennett', 'Brooks', 'Brown',
  'Campbell', 'Chen', 'Choi', 'Clark', 'Cole', 'Cooper', 'Davis', 'Diaz',
  'Edwards', 'Evans', 'Flores', 'Garcia', 'Green', 'Gupta', 'Hall', 'Harris',
  'Hernandez', 'Howard', 'Jackson', 'Johnson', 'Jones', 'Khan', 'Kim', 'King',
  'Lee', 'Lewis', 'Li', 'Lopez', 'Martin', 'Martinez', 'Miller', 'Mitchell',
  'Moore', 'Morgan', 'Murphy', 'Nguyen', 'Ortiz', 'Park', 'Patel', 'Perez',
  'Price', 'Ramirez', 'Reed', 'Rivera', 'Robinson', 'Rodriguez', 'Ross', 'Roy',
  'Shah', 'Singh', 'Smith', 'Taylor', 'Thomas', 'Walker', 'White', 'Williams',
]

function mix(seed, id, salt) {
  let value = (seed ^ Math.imul(id, 0x9e3779b1) ^ salt) >>> 0
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b)
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
  return (value ^ (value >>> 16)) >>> 0
}

export function importMapAnchors(store, mapPath) {
  const bytes = readFileSync(mapPath)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const existing = store.getMeta('map_hash')
  if (existing === hash) return { hash, imported: false }
  if (existing && store.db.prepare('SELECT 1 FROM npc LIMIT 1').get()) {
    throw new Error('Map changed after population generation; migrate anchors before importing a new map')
  }
  const network = JSON.parse(bytes.toString('utf8'))
  const zones = network.zones
  if (!zones || typeof zones !== 'object') throw new Error('Map has no zones')
  const anchors = new Map()
  for (const [zoneId, zone] of Object.entries(zones)) {
    if (!Array.isArray(zone.buildings) || !Array.isArray(zone.nodes) || !Array.isArray(zone.roads)) {
      throw new Error(`Map zone ${zoneId} lacks buildings, nodes, or roads`)
    }
    for (const b of zone.buildings) add(anchors, b.id, 'building', zoneId, b.name ?? null, b.x, b.z)
    for (const n of zone.nodes) add(anchors, n.id, 'road_node', zoneId, null, n.x, n.z)
    for (const road of zone.roads) {
      const middle = road.points?.[Math.floor(road.points.length / 2)]
      if (!middle) throw new Error(`Road ${road.id} lacks points`)
      add(anchors, road.id, 'road', zoneId, road.name ?? null, middle[0], middle[1])
      if (!anchors.has(road.from) || !anchors.has(road.to)) throw new Error(`Road ${road.id} has missing endpoint`)
    }
  }
  transaction(store.db, () => {
    store.db.exec('DELETE FROM map_anchor')
    const insert = store.db.prepare('INSERT INTO map_anchor(id,kind,zone_id,name,x,z,map_hash) VALUES(?,?,?,?,?,?,?)')
    insert.run(OFF_MAP_ANCHOR, 'off_map', 'off_map', 'Unmapped New York', null, null, 'manual')
    for (const anchor of anchors.values()) insert.run(...anchor, hash)
    store.setMeta('map_hash', hash)
    store.setMeta('map_version', String(network.version ?? 'unknown'))
  })
  return { hash, imported: true, anchors: anchors.size + 1 }
}

function add(anchors, id, kind, zone, name, x, z) {
  if (typeof id !== 'string' || !id || anchors.has(id) || !Number.isFinite(x) || !Number.isFinite(z)) {
    throw new Error(`Invalid or duplicate map anchor ${id}`)
  }
  anchors.set(id, [id, kind, zone, name, x, z])
}

export function seedPopulation(store, { count, seed = 1930, mappedLimit = 120000, batchSize = 10000, onBatch = () => {} }) {
  for (const [value, label, minimum] of [[count, 'count', 1], [seed, 'seed', 0], [mappedLimit, 'mappedLimit', 0], [batchSize, 'batchSize', 1]]) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${label} must be an integer >= ${minimum}`)
  }
  if (count > 1_000_000) throw new RangeError('The current population target is at most 1,000,000')
  const mapHash = store.getMeta('map_hash')
  if (!mapHash) throw new Error('Import the map anchors before seeding')
  const buildings = store.db.prepare("SELECT id,zone_id FROM map_anchor WHERE kind='building' ORDER BY id").all()
  if (!buildings.length) throw new Error('Map has no buildings')
  const savedSeed = store.getMeta('population_seed')
  const savedLimit = store.getMeta('mapped_limit')
  const savedVersion = store.getMeta('generator_version')
  const savedSource = store.getMeta('source_data_version')
  if ((savedSeed !== null && savedSeed !== String(seed)) || (savedLimit !== null && savedLimit !== String(mappedLimit)) ||
      (savedVersion !== null && savedVersion !== GENERATOR_VERSION) ||
      (savedSource !== null && savedSource !== SOURCE_DATA_VERSION)) {
    throw new Error('Population settings differ from existing data; use a new database or a migration')
  }
  const current = store.db.prepare('SELECT COALESCE(MAX(id),0) AS id,COUNT(*) AS count FROM npc').get()
  if (current.id !== current.count) throw new Error('NPC IDs are not contiguous; refusing to resume generation')
  if (current.count > count) throw new Error('Database already contains more people than the requested count')
  if (current.count && savedSource === null) store.setMeta('source_data_version', SOURCE_DATA_VERSION)
  const insertHousehold = store.db.prepare('INSERT OR IGNORE INTO household(id,home_anchor_id,profile_seed,generator_version) VALUES(?,?,?,?)')
  const insertNpc = store.db.prepare('INSERT INTO npc(id,household_id,display_name,birth_year,role,routine_code,appearance_seed,generator_version,home_zone_id) VALUES(?,?,?,?,?,?,?,?,?)')
  const insertAssignment = store.db.prepare('INSERT INTO npc_assignment(npc_id,kind,anchor_id,schedule_code,provenance) VALUES(?,?,?,?,?)')
  for (let first = current.count + 1; first <= count; first += batchSize) {
    const last = Math.min(count, first + batchSize - 1)
    transaction(store.db, () => {
      store.setMeta('population_seed', String(seed))
      store.setMeta('mapped_limit', String(mappedLimit))
      store.setMeta('generator_version', GENERATOR_VERSION)
      store.setMeta('source_data_version', SOURCE_DATA_VERSION)
      store.setMeta('population_target', String(count))
      for (let id = first; id <= last; id++) {
        const householdId = Math.floor((id - 1) / 3) + 1
        const householdFirstId = (householdId - 1) * 3 + 1
        const mapped = householdFirstId <= mappedLimit
        const homeBuilding = mapped ? buildings[mix(seed, householdId, 0x1001) % buildings.length] : null
        const home = homeBuilding?.id ?? OFF_MAP_ANCHOR
        insertHousehold.run(householdId, home, mix(seed, householdId, 0x1002), GENERATOR_VERSION)
        const birthYear = 1945 + mix(seed, id, 0x2001) % 76
        const role = birthYear >= 2009 ? 'student' : birthYear <= 1961 ? 'other' : 'worker'
        const name = `${firstNames[mix(seed, id, 0x2002) % firstNames.length]} ${lastNames[mix(seed, id, 0x2003) % lastNames.length]}`
        const routine = role === 'worker' ? 'weekday_work' : role === 'student' ? 'weekday_school' : 'daily_home'
        insertNpc.run(id, householdId, name, birthYear, role, routine, mix(seed, id, 0x2004), GENERATOR_VERSION, homeBuilding?.zone_id ?? 'off_map')
        if (role !== 'other') {
          const kind = role === 'student' ? 'school' : 'work'
          // Building use is unclassified in this map, so these destinations are explicitly synthetic.
          const anchor = mapped && role === 'worker'
            ? buildings[mix(seed, id, 0x2005) % buildings.length].id : OFF_MAP_ANCHOR
          insertAssignment.run(id, kind, anchor, routine, 'synthetic')
        }
      }
      store.setMeta('generated_count', String(last))
    })
    onBatch({ generated: last, target: count })
  }
  return { count: store.db.prepare('SELECT COUNT(*) AS count FROM npc').get().count, mapHash }
}
