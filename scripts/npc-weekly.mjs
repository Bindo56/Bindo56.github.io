import { resolve } from 'node:path'
import { DEFAULT_DATABASE_PATH, openPopulationDatabase } from '../server/population/database.mjs'
import { COHORT_KEY, materializeWeek, seedWeeklyPopulation } from '../server/population/seed-weekly.mjs'
import { auditWeeklyPopulation } from '../server/population/audit-weekly.mjs'
import { getRelationships, getStateAt, getWeek, newYorkLocalTime, recordInteraction } from '../server/population/weekly.mjs'

const [command = 'status', ...argumentsList] = process.argv.slice(2)
const flags = Object.fromEntries(argumentsList.map((argument) => {
  const match = /^--([\w-]+)=(.+)$/.exec(argument)
  if (!match) throw new Error(`Expected --name=value, got ${argument}`)
  return [match[1], match[2]]
}))
const databasePath = resolve(flags.db ?? DEFAULT_DATABASE_PATH)
const store = openPopulationDatabase(databasePath, { create: false })

function integer(name, fallback) {
  if (flags[name] === undefined) return fallback
  const value = Number(flags[name])
  if (!Number.isSafeInteger(value)) throw new RangeError(`--${name} must be a safe integer`)
  return value
}

function timeFlag() {
  if (!flags.time) return Date.now()
  const numeric = Number(flags.time)
  if (Number.isSafeInteger(numeric) && numeric >= 0) return numeric
  const parsed = Date.parse(flags.time)
  if (Number.isNaN(parsed)) throw new RangeError('--time must be an ISO timestamp or epoch milliseconds')
  return parsed
}

try {
  const weekStart = flags.week ?? newYorkLocalTime(Date.now()).weekStart
  if (command === 'seed') {
    const result = seedWeeklyPopulation(store, {
      count: integer('count', 100000), seed: integer('seed', 1930), weekStart,
      manifestPath: flags.manifest ?? 'public/assets/nju-jork/manifest.json',
      transitPath: flags.transit ?? 'public/assets/nju-jork/transit-network.json',
      onBatch: ({ generated, target }) => { if (generated % 10000 === 0 || generated === target) console.log(`Mapped ${generated}/${target}`) },
    })
    console.log(result)
  } else if (command === 'week') {
    console.log(materializeWeek(store, weekStart))
  } else if (command === 'npc') {
    const npcId = integer('id')
    const week = getWeek(store, npcId, weekStart)
    if (!week) throw new Error(`NPC ${npcId} is not in the cohort`)
    console.log(JSON.stringify({ ...week, relationships: getRelationships(store, npcId) }, null, 2))
  } else if (command === 'at') {
    const npcId = integer('id')
    const state = getStateAt(store, npcId, timeFlag())
    if (!state) throw new Error(`NPC ${npcId} is not in the cohort`)
    console.log(JSON.stringify(state, null, 2))
  } else if (command === 'interact') {
    const npcIds = (flags.ids ?? '').split(',').filter(Boolean).map(Number)
    const outcome = flags.delta === undefined ? {} : { relationshipDelta: integer('delta') }
    console.log(recordInteraction(store, { npcIds, worldTimeMs: timeFlag(), placeId: flags.place ?? null,
      kind: flags.kind ?? 'conversation', outcome, idempotencyKey: flags.key }))
  } else if (command === 'status') {
    const cohort = store.db.prepare('SELECT * FROM sim_cohort WHERE cohort_key=?').get(COHORT_KEY)
    console.log({ database: databasePath, schemaVersion: store.db.prepare('PRAGMA user_version').get().user_version,
      cohort, members: store.db.prepare('SELECT COUNT(*) AS n FROM sim_member WHERE cohort_key=?').get(COHORT_KEY).n,
      places: store.db.prepare('SELECT kind,COUNT(*) AS n FROM sim_place GROUP BY kind ORDER BY kind').all(),
      relationships: store.db.prepare('SELECT kind,COUNT(*) AS n FROM sim_relationship GROUP BY kind ORDER BY kind').all(),
      weeks: store.db.prepare('SELECT week_start,COUNT(*) AS n FROM sim_week GROUP BY week_start ORDER BY week_start').all(),
      meetings: store.db.prepare('SELECT week_start,COUNT(*) AS n FROM sim_meeting GROUP BY week_start ORDER BY week_start').all() })
  } else if (command === 'check') {
    const result = auditWeeklyPopulation(store, { expectedCount: integer('count', 100000), weekStart,
      sampleCount: integer('samples', 200) })
    console.log(result)
    if (!result.ok) process.exitCode = 1
  } else throw new Error(`Unknown command ${command}`)
} finally {
  store.close()
}
