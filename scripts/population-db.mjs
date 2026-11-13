import { resolve } from 'node:path'
import { DEFAULT_DATABASE_PATH, openPopulationDatabase } from '../server/population/database.mjs'
import { importMapAnchors, seedPopulation } from '../server/population/seed.mjs'

const [command = 'status', ...args] = process.argv.slice(2)
const flags = Object.fromEntries(args.map((arg) => {
  const match = /^--([\w-]+)=(.+)$/.exec(arg)
  if (!match) throw new Error(`Expected --name=value, got ${arg}`)
  return [match[1], match[2]]
}))
const path = resolve(flags.db ?? DEFAULT_DATABASE_PATH)
const store = openPopulationDatabase(path, { create: command === 'seed' })

function integer(name, fallback) {
  if (flags[name] === undefined) return fallback
  const value = Number(flags[name])
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`)
  return value
}

try {
  if (command === 'seed') {
    const mapPath = resolve(flags.map ?? 'public/assets/nju-jork/road-network.json')
    console.log('Map:', importMapAnchors(store, mapPath))
    const result = seedPopulation(store, {
      count: integer('count', 10000),
      seed: integer('seed', 1930),
      mappedLimit: integer('mapped-limit', 120000),
      batchSize: integer('batch-size', 10000),
      onBatch: ({ generated, target }) => console.log(`Generated ${generated}/${target}`),
    })
    console.log('Population:', result)
  } else if (command === 'status') {
    console.log({
      database: path,
      schemaVersion: store.db.prepare('PRAGMA user_version').get().user_version,
      npcCount: store.db.prepare('SELECT COUNT(*) AS count FROM npc').get().count,
      householdCount: store.db.prepare('SELECT COUNT(*) AS count FROM household').get().count,
      stateCount: store.db.prepare('SELECT COUNT(*) AS count FROM npc_state').get().count,
      eventCount: store.db.prepare('SELECT COUNT(*) AS count FROM npc_event').get().count,
      mapHash: store.getMeta('map_hash'),
      generatorVersion: store.getMeta('generator_version'),
      sourceDataVersion: store.getMeta('source_data_version'),
      worldTimeMs: store.getWorldTime(),
    })
  } else if (command === 'check') {
    const result = store.integrity()
    console.log(result)
    if (!result.ok) process.exitCode = 1
  } else if (command === 'backup') {
    const stamp = new Date().toISOString().replaceAll(':', '-')
    const destination = resolve(flags.to ?? `data/backups/population-${stamp}.sqlite`)
    await store.backup(destination)
    const verify = openPopulationDatabase(destination, { create: false })
    try {
      if (!verify.integrity().ok) throw new Error('Backup failed integrity checks')
      if (verify.db.prepare('SELECT COUNT(*) AS count FROM npc').get().count !== store.db.prepare('SELECT COUNT(*) AS count FROM npc').get().count) {
        throw new Error('Backup population count differs from source')
      }
    } finally {
      verify.close()
    }
    console.log(`Verified backup: ${destination}`)
  } else {
    throw new Error(`Unknown command ${command}`)
  }
} finally {
  store.close()
}
