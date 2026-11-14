import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { DEFAULT_DATABASE_PATH, openPopulationDatabase } from '../server/population/database.mjs'
import { COHORT_KEY } from '../server/population/seed-weekly.mjs'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'public/assets/nju-jork/npc-data')
const cellSize = 384
const catalogHash = createHash('sha256').update(readFileSync(resolve(root, 'public/assets/nju-jork/place-catalog.json'))).digest('hex')
const store = openPopulationDatabase(DEFAULT_DATABASE_PATH, { create: false })
const digest = (value) => createHash('sha256').update(value).digest('hex')
const encode = (value) => JSON.stringify(value)
const write = (name, value) => {
  const content = encode(value)
  writeFileSync(resolve(output, name), content)
  return { file: name, bytes: Buffer.byteLength(content), gzipBytes: gzipSync(content).length, hash: digest(content) }
}

try {
  if (store.getMeta('nyc_place_catalog_sha256') !== catalogHash) throw new Error('Catalog and local NPC assignments differ')
  const db = store.db
  const cohort = db.prepare('SELECT * FROM sim_cohort WHERE cohort_key=?').get(COHORT_KEY)
  if (!cohort || cohort.generated_count !== 100000) throw new Error('The 100,000 NPC cohort is incomplete')
  mkdirSync(output, { recursive: true })

  const meetingsByNpc = new Map()
  const meetings = db.prepare(`SELECT id,week_start,npc_a_id,npc_b_id,place_id,weekday,start_minute,duration_minute,status
    FROM sim_meeting WHERE status<>'cancelled' ORDER BY week_start,weekday,start_minute,id`).all()
  for (const meeting of meetings) {
    const compact = [meeting.id, meeting.week_start, meeting.npc_a_id, meeting.npc_b_id,
      meeting.place_id, meeting.weekday, meeting.start_minute, meeting.duration_minute, meeting.status]
    for (const id of [meeting.npc_a_id, meeting.npc_b_id]) {
      const list = meetingsByNpc.get(id) ?? []
      list.push(compact)
      meetingsByNpc.set(id, list)
    }
  }
  const groups = new Map()
  const members = db.prepare(`SELECT m.*,n.display_name,n.household_id,n.role,n.appearance_seed,
    a.x AS home_x,a.z AS home_z FROM sim_member m JOIN npc n ON n.id=m.npc_id
    JOIN sim_place p ON p.id=m.home_place_id JOIN map_anchor a ON a.id=p.anchor_id
    WHERE m.cohort_key=? ORDER BY m.npc_id`).all(COHORT_KEY)
  for (const { home_x, home_z, ...member } of members) {
    const cx = Math.floor(home_x / cellSize), cz = Math.floor(home_z / cellSize)
    const id = `${cx}_${cz}`
    const group = groups.get(id) ?? { id, cx, cz, members: [] }
    group.members.push({ ...member, meetings: meetingsByNpc.get(member.npc_id) ?? [] })
    groups.set(id, group)
  }
  const shards = [...groups.values()].sort((a, b) => a.cx - b.cx || a.cz - b.cz).map(({ id, cx, cz, members }) => ({
    id, cx, cz, count: members.length,
    ...write(`shard-${id}.json`, { version: 1, id, members }),
  }))
  const places = db.prepare(`SELECT p.id,p.anchor_id,p.kind,p.label,a.x,a.z
    FROM sim_place p JOIN map_anchor a ON a.id=p.anchor_id WHERE p.active=1 ORDER BY p.id`).all()
  const placeFile = write('places.json', { version: 1, places })
  const relationships = db.prepare(`SELECT npc_a_id,npc_b_id,kind,strength
    FROM sim_relationship ORDER BY npc_a_id,npc_b_id,kind`).all()
    .map((row) => [row.npc_a_id, row.npc_b_id, row.kind, row.strength])
  const relationFile = write('relationships.json', { version: 1, relationships })
  const weeks = db.prepare('SELECT DISTINCT week_start FROM sim_week ORDER BY week_start').all().map((row) => row.week_start)
  const datasetId = digest(encode({ catalogHash, shards: shards.map(({ id, hash }) => [id, hash]),
    places: placeFile.hash, relationships: relationFile.hash, weeks })).slice(0, 20)
  const manifest = { version: 1, datasetId, cohort: COHORT_KEY, catalogHash, timezone: 'America/New_York',
    firstWeek: cohort.week_start, materializedWeeks: weeks, cellSize, totalMembers: members.length,
    totalMeetings: meetings.length, totalRelationships: relationships.length,
    places: placeFile, relationships: relationFile, shards }
  write('manifest.json', manifest)
  const all = [placeFile, relationFile, ...shards]
  console.log(JSON.stringify({ output, datasetId, members: members.length, shards: shards.length,
    meetings: meetings.length, relationships: relationships.length,
    jsonMB: +(all.reduce((sum, item) => sum + item.bytes, 0) / 1e6).toFixed(2),
    gzipMB: +(all.reduce((sum, item) => sum + item.gzipBytes, 0) / 1e6).toFixed(2) }, null, 2))
} finally {
  store.close()
}
