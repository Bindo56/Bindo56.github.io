import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_DATABASE_PATH, openPopulationDatabase } from '../server/population/database.mjs'
import { COHORT_KEY } from '../server/population/seed-weekly.mjs'

const root = resolve(import.meta.dirname, '..')
const catalogPath = resolve(root, 'public/assets/nju-jork/place-catalog.json')
const outputPath = resolve(root, 'public/assets/nju-jork/npc-place-occupancy.json')
const catalogHash = createHash('sha256').update(readFileSync(catalogPath)).digest('hex')
const store = openPopulationDatabase(DEFAULT_DATABASE_PATH, { create: false })

try {
  if (store.getMeta('nyc_place_catalog_sha256') !== catalogHash) {
    throw new Error('The local NPC assignments do not match the published place catalog')
  }
  const db = store.db
  const members = db.prepare('SELECT COUNT(*) n FROM sim_member WHERE cohort_key=?').get(COHORT_KEY).n
  if (members !== 100000) throw new Error(`Expected 100,000 cohort members, found ${members}`)
  const anchors = {}
  const entry = (id) => anchors[id] ??= { residents: 0, workers: 0, students: 0 }
  for (const row of db.prepare(`SELECT p.anchor_id,COUNT(*) n FROM sim_member m
    JOIN sim_place p ON p.id=m.home_place_id WHERE m.cohort_key=? GROUP BY p.anchor_id`).all(COHORT_KEY)) {
    entry(row.anchor_id).residents = row.n
  }
  for (const row of db.prepare(`SELECT p.anchor_id,n.role,COUNT(*) n FROM sim_member m
    JOIN sim_place p ON p.id=m.work_place_id JOIN npc n ON n.id=m.npc_id
    WHERE m.cohort_key=? GROUP BY p.anchor_id,n.role`).all(COHORT_KEY)) {
    if (row.role === 'student') entry(row.anchor_id).students = row.n
    else entry(row.anchor_id).workers = row.n
  }
  const summary = {
    members,
    households: db.prepare('SELECT COUNT(*) n FROM sim_household_home').get().n,
    homeBuildings: Object.values(anchors).filter((item) => item.residents > 0).length,
    workers: Object.values(anchors).reduce((sum, item) => sum + item.workers, 0),
    students: Object.values(anchors).reduce((sum, item) => sum + item.students, 0),
  }
  writeFileSync(outputPath, JSON.stringify({ version: 1, cohort: COHORT_KEY, catalogHash,
    generatedAt: new Date().toISOString(), note: 'Counts are fictional NPC assignments, not real residents or employees.',
    summary, anchors }))
  console.log(JSON.stringify({ outputPath, summary, anchorCount: Object.keys(anchors).length }))
} finally {
  store.close()
}
