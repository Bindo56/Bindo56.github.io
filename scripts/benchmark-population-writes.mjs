import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { openPopulationDatabase, transaction } from '../server/population/database.mjs'

const [file, requested = '10000'] = process.argv.slice(2)
if (!file) throw new Error('Pass a disposable seeded database path; this benchmark writes checkpoints and events')
const count = Number(requested)
if (!Number.isSafeInteger(count) || count < 1) throw new RangeError('Write count must be positive')
const store = openPopulationDatabase(resolve(file), { create: false })
try {
  const population = store.db.prepare('SELECT COUNT(*) AS count FROM npc').get().count
  if (count > population) throw new RangeError('Write count exceeds population')
  const worldTimeMs = 1_800_000_000_000
  const start = performance.now()
  for (let first = 1; first <= count; first += 1000) {
    const last = Math.min(count, first + 999)
    transaction(store.db, () => {
      for (let id = first; id <= last; id++) {
        store.saveCheckpoint({ npcId: id, worldTimeMs, activity: 'benchmark' })
        store.appendEvent({ npcId: id, worldTimeMs, eventType: 'benchmark', idempotencyKey: `benchmark:${id}` })
      }
    })
  }
  const seconds = (performance.now() - start) / 1000
  console.log(JSON.stringify({ count, checkpoints: count, events: count, seconds: Number(seconds.toFixed(3)),
    pairsPerSecond: Math.round(count / seconds), integrity: store.integrity().ok }, null, 2))
} finally {
  store.close()
}
