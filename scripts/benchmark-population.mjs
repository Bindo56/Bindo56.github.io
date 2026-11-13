import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DEFAULT_DATABASE_PATH, openPopulationDatabase } from '../server/population/database.mjs'

const path = resolve(process.argv[2] ?? DEFAULT_DATABASE_PATH)
const store = openPopulationDatabase(path, { create: false })
function bytes(file) { return existsSync(file) ? statSync(file).size : 0 }
function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
  return Number(sorted[Math.floor((sorted.length - 1) * fraction)].toFixed(3))
}
function measure(task, samples = 200) {
  const times = []
  for (let i = 0; i < samples; i++) {
    const start = performance.now()
    task(i)
    times.push(performance.now() - start)
  }
  return { samples, p50Ms: percentile(times, 0.5), p95Ms: percentile(times, 0.95), maxMs: percentile(times, 1) }
}

try {
  const count = store.db.prepare('SELECT COUNT(*) AS count FROM npc').get().count
  if (!count) throw new Error('Seed the population before benchmarking')
  // Warm prepared statements and the OS page cache before timing.
  store.getNpc(1)
  store.listNpcByHomeArea('city', { limit: 100 })
  const metrics = {
    database: path,
    count,
    bytes: { main: bytes(path), wal: bytes(`${path}-wal`), shm: bytes(`${path}-shm`) },
    processMemoryMiB: {
      rss: Number((process.memoryUsage().rss / 1048576).toFixed(1)),
      heapUsed: Number((process.memoryUsage().heapUsed / 1048576).toFixed(1)),
    },
    lookupById: measure((i) => store.getNpc((Math.imul(i + 1, 7919) >>> 0) % count + 1)),
    cityHomePage100: measure((i) => store.listNpcByHomeArea('city', { afterId: i * 107, limit: 100 })),
    queryPlan: store.db.prepare(`EXPLAIN QUERY PLAN
      SELECT n.id FROM npc n JOIN household h ON h.id=n.household_id
      WHERE n.home_zone_id=? AND n.id>? ORDER BY n.id LIMIT ?`).all('city', 0, 100),
  }
  console.log(JSON.stringify(metrics, null, 2))
} finally {
  store.close()
}
