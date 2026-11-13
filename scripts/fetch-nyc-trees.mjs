// Cache the NYC Parks Forestry Tree Points inventory for the Manhattan map.
// Run: node scripts/fetch-nyc-trees.mjs [--refresh]
// Source: https://data.cityofnewyork.us/Environment/Forestry-Tree-Points/hn5i-inap

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const file = resolve(import.meta.dirname, '../.cache/manhattan-osm/forestry-trees.json')
if (existsSync(file) && !process.argv.includes('--refresh')) {
  console.log('NYC Forestry tree points: cached')
  process.exit(0)
}

const trees = []
const pageSize = 20000
for (let offset = 0; ; offset += pageSize) {
  const url = new URL('https://data.cityofnewyork.us/resource/hn5i-inap.json')
  const dollar = String.fromCharCode(36)
  url.searchParams.set(`${dollar}select`, 'objectid,dbh,tpstructure,tpcondition,genusspecies,location')
  url.searchParams.set(`${dollar}where`, "within_box(location,40.8,-74.03,40.695,-73.92) AND tpstructure = 'Full'")
  url.searchParams.set(`${dollar}order`, 'objectid')
  url.searchParams.set(`${dollar}limit`, String(pageSize))
  url.searchParams.set(`${dollar}offset`, String(offset))
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`NYC Forestry tree points HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
  const page = await response.json()
  trees.push(...page.filter((tree) => tree.location?.coordinates?.length === 2 && tree.tpcondition !== 'Dead'))
  console.log(`NYC Forestry tree points: ${offset + page.length} read`)
  if (page.length < pageSize) break
}

mkdirSync(resolve(import.meta.dirname, '../.cache/manhattan-osm'), { recursive: true })
writeFileSync(file, JSON.stringify({
  source: 'NYC Parks Forestry Tree Points (ForMS 2.0)',
  url: 'https://data.cityofnewyork.us/Environment/Forestry-Tree-Points/hn5i-inap',
  fetchedAt: new Date().toISOString(),
  trees,
}))
console.log(`NYC Forestry tree points: ${trees.length} living trees cached`)
