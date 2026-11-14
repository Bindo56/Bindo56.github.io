// Cache public place data for the Manhattan area covered by the current 3D city.
// PLUTO identifies tax-lot uses; DOHMH identifies active food establishments;
// OpenStreetMap supplies other mapped amenities and shops.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, '.cache/nyc-place-sources')
const refresh = process.argv.includes('--refresh')
const bbox = { south: 40.688, west: -74.052, north: 40.802, east: -73.916 }
const quote = (value) => `'${value.replaceAll("'", "''")}'`
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function request(url, options) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(120_000) })
      if (response.ok) return await response.json()
      const body = await response.text()
      if (response.status < 500 && response.status !== 429) throw new Error(`${response.status}: ${body.slice(0, 300)}`)
      console.warn(`${response.status} from ${new URL(url).host}; retrying`)
    } catch (error) {
      if (attempt === 4) throw error
      console.warn(`${error.message}; retrying`)
    }
    await sleep((attempt + 1) * 3000)
  }
  throw new Error(`Could not fetch ${url}`)
}

async function socrata(name, dataset, select, where, order) {
  const file = resolve(out, `${name}.json`)
  if (existsSync(file) && !refresh) {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    console.log(`${name}: ${data.rows.length} cached records`)
    return
  }
  const rows = []
  const limit = 5000
  for (let offset = 0; ; offset += limit) {
    const url = new URL(`https://data.cityofnewyork.us/resource/${dataset}.json`)
    url.searchParams.set('$select', select)
    url.searchParams.set('$where', where)
    url.searchParams.set('$order', order)
    url.searchParams.set('$limit', String(limit))
    url.searchParams.set('$offset', String(offset))
    const page = await request(url)
    if (!Array.isArray(page)) throw new Error(`${name}: expected a Socrata row array`)
    rows.push(...page)
    console.log(`${name}: ${rows.length} records`)
    if (page.length < limit) break
  }
  writeFileSync(file, JSON.stringify({ source: `https://data.cityofnewyork.us/d/${dataset}`, fetchedAt: new Date().toISOString(), bbox, rows }))
}

async function osmPlaces() {
  const file = resolve(out, 'osm-places.json')
  if (existsSync(file) && !refresh) {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    console.log(`osm-places: ${data.elements.length} cached elements`)
    return
  }
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  const query = `[out:json][timeout:180];(nwr["amenity"~"^(cafe|restaurant|fast_food|bar|pub|school|college|university|library|clinic|hospital|doctors|community_centre|pharmacy|bank|post_office)$"](${box});nwr["shop"](${box});nwr["office"](${box}););out center tags;`
  const servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
  let data
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      data = await request(servers[attempt % servers.length], {
        method: 'POST', headers: { 'User-Agent': 'system-zero-place-map/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      })
      if (Array.isArray(data.elements)) break
      data = null
    } catch (error) {
      console.warn(`Overpass attempt ${attempt + 1}: ${error.message}`)
      await sleep(5000)
    }
  }
  if (!data?.elements) throw new Error('Could not fetch OpenStreetMap places')
  const elements = data.elements.map(({ type, id, lat, lon, center, tags }) => ({ type, id, lat, lon, center, tags }))
  writeFileSync(file, JSON.stringify({ source: 'https://www.openstreetmap.org/copyright', fetchedAt: new Date().toISOString(), bbox, elements }))
  console.log(`osm-places: ${elements.length} elements`)
}

mkdirSync(out, { recursive: true })
const within = `latitude between ${bbox.south} and ${bbox.north} and longitude between ${bbox.west} and ${bbox.east}`
await socrata('pluto', '64uk-42ks',
  'bbl,address,landuse,bldgclass,unitsres,resarea,officearea,retailarea,numbldgs,latitude,longitude,version',
  `borough=${quote('MN')} and ${within}`, 'bbl')
await socrata('restaurants', '43nn-pn8j',
  'distinct camis,dba,building,street,zipcode,cuisine_description,latitude,longitude,bbl',
  `boro=${quote('Manhattan')} and ${within}`, 'camis')
await osmPlaces()
