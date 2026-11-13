// Download the OpenStreetMap layers the real Nju Jork map is built from (Manhattan south of ~100th St):
// island outline, every highway (streets, sidewalks, paths), buildings, and parks/water.
// Run: node scripts/fetch-manhattan-osm.mjs [--refresh]   → .cache/manhattan-osm/*.json
// Data © OpenStreetMap contributors, ODbL. Overpass is often busy, so each layer retries and is cached.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const out = resolve(import.meta.dirname, '../.cache/manhattan-osm')
const refresh = process.argv.includes('--refresh')
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
const BANDS = [[40.695, 40.722], [40.722, 40.746], [40.746, 40.768], [40.768, 40.8]]
const box = ([south, north]) => `${south},-74.03,${north},-73.92`
const GREEN = '^(park|garden|playground|pitch|dog_park|nature_reserve|common|sports_centre|track)$'
const LANDUSE = '^(grass|cemetery|recreation_ground|village_green|meadow|forest|flowerbed)$'

const layers = {
  // OSM relation "Manhattan Island" (place=island, Q15063317).
  island: '[out:json][timeout:90];relation(3954665);out geom;',
  areas: `[out:json][timeout:150];(way["leisure"~"${GREEN}"](40.695,-74.03,40.8,-73.92);relation["leisure"~"${GREEN}"](40.695,-74.03,40.8,-73.92);way["landuse"~"${LANDUSE}"](40.695,-74.03,40.8,-73.92);relation["landuse"~"${LANDUSE}"](40.695,-74.03,40.8,-73.92);way["natural"~"^(water|wood|scrub|grassland)$"](40.695,-74.03,40.8,-73.92);relation["natural"~"^(water|wood)$"](40.695,-74.03,40.8,-73.92););out geom tags;`,
}
// Exact street surfaces: plazas, sidewalk areas and road areas mapped as area:highway polygons (Times Square plazas etc.).
layers.surfaces = '[out:json][timeout:150];(way["area:highway"](40.695,-74.03,40.8,-73.92);relation["area:highway"](40.695,-74.03,40.8,-73.92););out geom tags;'
// Street-level detail: street trees, tree rows, subway entrances and street lamps.
layers.furniture = '[out:json][timeout:150];(node["natural"="tree"](40.695,-74.03,40.8,-73.92);way["natural"="tree_row"](40.695,-74.03,40.8,-73.92);node["railway"="subway_entrance"](40.695,-74.03,40.8,-73.92);node["highway"="street_lamp"](40.695,-74.03,40.8,-73.92););out geom tags;'
// Track tags distinguish outdoor/elevated rail from underground subway tunnels.
layers.railways = '[out:json][timeout:150];way["railway"~"^(subway|rail|light_rail|tram)$"](40.695,-74.03,40.8,-73.92);out geom tags;'
BANDS.forEach((band, index) => {
  layers[`highways-${index}`] = `[out:json][timeout:170];way["highway"](${box(band)});out geom tags;`
  layers[`buildings-${index}`] = `[out:json][timeout:170];(way["building"](${box(band)});relation["building"](${box(band)}););out geom tags;`
})

mkdirSync(out, { recursive: true })
for (const [name, query] of Object.entries(layers)) {
  const file = resolve(out, `${name}.json`)
  if (!refresh && existsSync(file)) { console.log(`${name}: cached`); continue }
  let done = false
  for (let attempt = 0; attempt < 8 && !done; attempt += 1) {
    const server = SERVERS[attempt % SERVERS.length]
    try {
      const response = await fetch(server, {
        method: 'POST',
        headers: { 'User-Agent': 'system-zero-map/1.0 (build script)', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(200_000),
      })
      const text = await response.text()
      if (response.ok && text.startsWith('{')) {
        const elements = JSON.parse(text).elements.length
        writeFileSync(file, text)
        console.log(`${name}: ${elements} elements, ${(text.length / 1e6).toFixed(1)} MB`)
        done = true
      } else {
        console.log(`${name}: ${server.split('/')[2]} HTTP ${response.status}, retrying`)
      }
    } catch (error) {
      console.log(`${name}: ${server.split('/')[2]} ${error.name === 'TimeoutError' ? 'timed out' : error.message}, retrying`)
    }
    if (!done) await new Promise((resolveWait) => setTimeout(resolveWait, 20_000))
  }
  if (!done) { console.log(`${name}: FAILED, rerun later`); process.exitCode = 1 }
  await new Promise((resolveWait) => setTimeout(resolveWait, 4000))
}
