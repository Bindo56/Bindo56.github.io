// Replace generated planning labels in road-network.json with real names from OpenStreetMap:
// street names for roads, building/place names and street addresses for buildings.
// Only for the original Minecraft-frame world (extract → widen → annotate). The real-geometry world
// from build-real-nju-jork.mjs already carries OSM names, so this step is not needed there.
// World blocks are converted to lat/lon with public/assets/nju-jork/georef.json.
//
// Run after annotate-nju-jork.py (which rewrites the labels): node scripts/real-names-nju-jork.mjs [--refresh]
// Needs Node 23.6+ (imports the TypeScript georef module directly). Safe to rerun.
// OSM data © OpenStreetMap contributors, ODbL. Downloads are cached in .cache/nju-jork-osm/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGeoref } from '../src/worlds/georef.ts'

const root = resolve(import.meta.dirname, '..')
const assetDir = resolve(root, 'public/assets/nju-jork')
const cacheDir = resolve(root, '.cache/nju-jork-osm')
const refresh = process.argv.includes('--refresh')

const BBOX = '40.695,-74.025,40.795,-73.935'
const ROADS = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$'
const AMENITIES = '^(theatre|university|college|hospital|library|museum|arts_centre|place_of_worship|townhall|courthouse|police|fire_station|school|cinema|marketplace|bus_station|community_centre|events_venue)$'
const QUERIES = {
  streets: `[out:json][timeout:170];way["highway"~"${ROADS}"]["name"](${BBOX});out geom tags;`,
  'places-buildings': `[out:json][timeout:120];(way["building"]["name"](${BBOX});relation["building"]["name"](${BBOX}););out center tags;`,
  'places-poi': `[out:json][timeout:120];(nwr["tourism"]["name"](${BBOX});nwr["amenity"~"${AMENITIES}"]["name"](${BBOX});nwr["railway"="station"]["name"](${BBOX});nwr["leisure"~"^(park|stadium|garden|sports_centre)$"]["name"](${BBOX});nwr["historic"]["name"](${BBOX}););out center tags;`,
  'addresses-south': '[out:json][timeout:150];nwr["addr:housenumber"]["addr:street"](40.695,-74.025,40.745,-73.935);out center tags;',
  'addresses-north': '[out:json][timeout:150];nwr["addr:housenumber"]["addr:street"](40.745,-74.025,40.795,-73.935);out center tags;',
}

async function osm(name) {
  const file = resolve(cacheDir, `${name}.json`)
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).elements
  mkdirSync(cacheDir, { recursive: true })
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': 'system-zero-names/1.0 (build script)', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: QUERIES[name] }),
    })
    if (response.ok) {
      const text = await response.text()
      writeFileSync(file, text)
      return JSON.parse(text).elements
    }
    console.log(`${name}: Overpass HTTP ${response.status}, retrying (${attempt}/4)`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 15_000))
  }
  throw new Error(`Could not download ${name} from Overpass; try again later.`)
}

// ---------- geometry ----------

const LAT0 = 40.75
const LON0 = -73.985
const M_LON = Math.cos((LAT0 * Math.PI) / 180) * 111_320
const M_LAT = 110_574
const toEN = (lat, lon) => [(lon - LON0) * M_LON, (lat - LAT0) * M_LAT]

const georef = createGeoref(JSON.parse(readFileSync(resolve(assetDir, 'georef.json'), 'utf8')).points)
const worldToEN = (x, z) => {
  const { lat, lon } = georef.toGeo({ x, z })
  return toEN(lat, lon)
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

const axisAngle = (a, b) => ((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 180) % 180
const angleGap = (a, b) => Math.min(Math.abs(a - b), 180 - Math.abs(a - b))

function inside(point, polygon) {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

const edgeDistance = (point, polygon) =>
  Math.min(...polygon.map((corner, index) => segmentDistance(point, corner, polygon[(index + 1) % polygon.length])))

/** Uniform grid bucket index over EN meters. */
class Grid {
  constructor(cell) {
    this.cell = cell
    this.buckets = new Map()
  }
  key(cx, cy) { return `${cx},${cy}` }
  add(item, minE, minN, maxE, maxN) {
    for (let cx = Math.floor(minE / this.cell); cx <= Math.floor(maxE / this.cell); cx += 1)
      for (let cy = Math.floor(minN / this.cell); cy <= Math.floor(maxN / this.cell); cy += 1) {
        const key = this.key(cx, cy)
        if (!this.buckets.has(key)) this.buckets.set(key, [])
        this.buckets.get(key).push(item)
      }
  }
  near([e, n], radius) {
    const found = new Set()
    for (let cx = Math.floor((e - radius) / this.cell); cx <= Math.floor((e + radius) / this.cell); cx += 1)
      for (let cy = Math.floor((n - radius) / this.cell); cy <= Math.floor((n + radius) / this.cell); cy += 1)
        for (const item of this.buckets.get(this.key(cx, cy)) ?? []) found.add(item)
    return found
  }
}

// ---------- names ----------

const SUFFIXES = [[/ Street$/, ' St'], [/ Avenue$/, ' Ave'], [/ Boulevard$/, ' Blvd'], [/ Place$/, ' Pl'], [/ Drive$/, ' Dr'], [/ Parkway$/, ' Pkwy'], [/ Road$/, ' Rd'], [/ Square$/, ' Sq'], [/ Lane$/, ' Ln'], [/ Highway$/, ' Hwy'], [/ Terrace$/, ' Ter'], [/ Court$/, ' Ct'], [/ Plaza$/, ' Plz']]
/** "West 42nd Street" → "W 42nd St"; "South Street" stays recognisable as "South St". */
function shortName(name) {
  let short = name
  if (short.split(' ').length >= 3) short = short.replace(/^(West|East|North|South) /, (match) => `${match[0]} `)
  for (const [pattern, replacement] of SUFFIXES) short = short.replace(pattern, replacement)
  return short
}

const centre = (element) => (element.center ? [element.center.lat, element.center.lon] : element.lat !== undefined ? [element.lat, element.lon] : null)

// Notable first; a named building beats an attraction or venue inside it (One WTC over its observatory).
function placeScore(tags) {
  let score = 0
  if (tags.wikidata || tags.wikipedia) score += 4
  if (tags.building) score += 2
  if (tags.tourism === 'attraction' || tags.historic) score += 1
  if (tags.amenity || tags.railway || tags.leisure) score += 1
  return score
}

function formatAddress(tags) {
  const street = shortName(tags['addr:street'])
  const postcode = tags['addr:postcode'] ? ` ${tags['addr:postcode']}` : ''
  return { short: `${tags['addr:housenumber']} ${street}`, full: `${tags['addr:housenumber']} ${street}, New York, NY${postcode}` }
}

// ---------- run ----------

const network = JSON.parse(readFileSync(resolve(assetDir, 'road-network.json'), 'utf8'))
const zone = network.zones.city
const [streetWays, buildingPlaces, poiPlaces, addressesSouth, addressesNorth] = await Promise.all(
  ['streets', 'places-buildings', 'places-poi', 'addresses-south', 'addresses-north'].map(osm),
)

const streetGrid = new Grid(60)
for (const way of streetWays) {
  const points = (way.geometry ?? []).map(({ lat, lon }) => toEN(lat, lon))
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    streetGrid.add({ a, b, name: way.tags.name, angle: axisAngle(a, b) }, Math.min(a[0], b[0]) - 30, Math.min(a[1], b[1]) - 30, Math.max(a[0], b[0]) + 30, Math.max(a[1], b[1]) + 30)
  }
}

const placeGrid = new Grid(80)
const seenPlaces = new Set()
for (const element of [...buildingPlaces, ...poiPlaces]) {
  const at = centre(element)
  const key = `${element.type}/${element.id}`
  if (!at || seenPlaces.has(key)) continue
  seenPlaces.add(key)
  const point = toEN(...at)
  placeGrid.add({ point, tags: element.tags, score: placeScore(element.tags) }, point[0], point[1], point[0], point[1])
}

const addressGrid = new Grid(80)
for (const element of [...addressesSouth, ...addressesNorth]) {
  const at = centre(element)
  if (!at) continue
  const point = toEN(...at)
  addressGrid.add({ point, tags: element.tags }, point[0], point[1], point[0], point[1])
}

// Roads: sample along each road, vote for the nearest real street running the same way.
let namedRoads = 0
for (const road of zone.roads) {
  road.planName ??= road.name
  const world = road.points
  const step = Math.max(1, Math.floor(world.length / 8))
  const votes = new Map()
  let samples = 0
  for (let i = 0; i < world.length; i += step) {
    // Skeleton roads zigzag block by block, so read direction over ±4 points (~16 blocks).
    const before = world[Math.max(0, i - 4)]
    const after = world[Math.min(world.length - 1, i + 4)]
    if (before === after) continue
    samples += 1
    const point = worldToEN(...world[i])
    const angle = axisAngle(worldToEN(...before), worldToEN(...after))
    let best = null
    let bestDistance = 25
    for (const segment of streetGrid.near(point, 25)) {
      if (angleGap(angle, segment.angle) > 25) continue
      const distance = segmentDistance(point, segment.a, segment.b)
      if (distance < bestDistance) {
        bestDistance = distance
        best = segment
      }
    }
    if (best) votes.set(best.name, (votes.get(best.name) ?? 0) + 1)
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1])
  const total = ranked.reduce((sum, [, count]) => sum + count, 0)
  if (ranked.length && total >= samples * 0.5 && ranked[0][1] >= total * 0.6) {
    road.fullName = ranked[0][0]
    road.name = shortName(ranked[0][0])
    road.nameSource = 'osm'
    namedRoads += 1
  } else {
    // No confident match (plaza scraps, mid-block passages, unbuilt areas): no label rather than a made-up one.
    road.name = ''
    delete road.fullName
    road.nameSource = 'plan'
  }
}

// Fill gaps: an unnamed piece continuing a named street in the same direction takes its name.
const worldAngle = (road) => {
  const [first, last] = [road.points[0], road.points[road.points.length - 1]]
  return ((Math.atan2(last[1] - first[1], last[0] - first[0]) * 180) / Math.PI + 180) % 180
}
const roadsAtNode = new Map()
for (const road of zone.roads) for (const node of [road.from, road.to]) roadsAtNode.set(node, [...(roadsAtNode.get(node) ?? []), road])
for (let pass = 0; pass < 3; pass += 1) {
  for (const road of zone.roads) {
    if (road.nameSource === 'osm') continue
    const angle = worldAngle(road)
    const ends = [road.from, road.to].map((node) => new Set((roadsAtNode.get(node) ?? [])
      .filter((other) => other !== road && other.nameSource === 'osm' && angleGap(angle, worldAngle(other)) < 20)
      .map((other) => other.fullName)))
    const names = new Set([...ends[0], ...ends[1]])
    const bothEnds = ends[0].size === 1 && ends[1].size === 1 && names.size === 1
    const shortGap = road.length < 30 && names.size === 1
    if (bothEnds || shortGap) {
      road.fullName = [...names][0]
      road.name = shortName(road.fullName)
      road.nameSource = 'osm'
      namedRoads += 1
    }
  }
}

const namedRoadPoints = zone.roads.filter((road) => road.nameSource === 'osm').flatMap((road) => road.points.map((point) => ({ point, road })))
function nearestStreet(x, z) {
  let best = null
  let bestDistance = 60
  for (const { point, road } of namedRoadPoints) {
    const distance = Math.hypot(point[0] - x, point[1] - z)
    if (distance < bestDistance) {
      bestDistance = distance
      best = road
    }
  }
  return best
}

// Buildings: the most notable named place inside the footprint, plus the address nearest its middle.
const roadsById = new Map(zone.roads.map((road) => [road.id, road]))
const counts = { place: 0, address: 0, plan: 0 }
const famous = []
for (const building of zone.buildings) {
  building.planName ??= building.name
  building.planAddress ??= building.address
  const [x0, z0, x1, z1] = building.bounds
  const footprint = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => worldToEN(x, z))
  const middle = worldToEN(building.x, building.z)
  const radius = Math.max(...footprint.map((corner) => Math.hypot(corner[0] - middle[0], corner[1] - middle[1]))) + 20
  const covers = (point, margin) => inside(point, footprint) || edgeDistance(point, footprint) <= margin

  const places = [...placeGrid.near(middle, radius)].filter((place) => covers(place.point, 15))
  places.sort((a, b) => b.score - a.score || Math.hypot(a.point[0] - middle[0], a.point[1] - middle[1]) - Math.hypot(b.point[0] - middle[0], b.point[1] - middle[1]))
  const byDistance = (a, b) => Math.hypot(a.point[0] - middle[0], a.point[1] - middle[1]) - Math.hypot(b.point[0] - middle[0], b.point[1] - middle[1])
  const nearby = [...addressGrid.near(middle, radius + 40)]
  const addresses = nearby.filter((address) => covers(address.point, 10)).sort(byDistance)
  // A named place with no address inside its footprint can borrow the closest one just outside.
  const closeAddress = nearby.filter((address) => covers(address.point, 40)).sort(byDistance)[0]

  let place = places[0]
  // Prefer the building entry when a venue or viewpoint inside it shares its Wikidata ID.
  if (place && !place.tags.building && place.tags.wikidata) {
    place = [...placeGrid.near(middle, radius + 80)].find((other) => other.tags.wikidata === place.tags.wikidata && other.tags.building) ?? place
  }
  const placeAddress = place?.tags['addr:housenumber'] && place.tags['addr:street'] ? formatAddress(place.tags) : null
  const address = placeAddress ?? (addresses[0] ? formatAddress(addresses[0].tags) : place && closeAddress ? formatAddress(closeAddress.tags) : null)
  const linked = roadsById.get(building.streetId)
  const street = linked?.nameSource === 'osm' ? linked : nearestStreet(building.x, building.z)
  if (place) {
    building.name = place.tags.name
    building.address = address?.full ?? (street ? `${street.name}, New York, NY` : 'Address unknown')
    building.nameSource = 'osm-place'
    counts.place += 1
    if (place.score >= 4) famous.push(`${building.id} ${place.tags.name}`)
  } else if (address) {
    building.name = address.short
    building.address = address.full
    building.nameSource = 'osm-address'
    counts.address += 1
  } else {
    building.name = building.planName
    building.address = street ? `${street.name}, New York, NY` : 'Address unknown'
    building.nameSource = 'plan'
    counts.plan += 1
  }
}

network.labelSource = 'Street names, building names and addresses from OpenStreetMap (© OpenStreetMap contributors, ODbL), matched to world blocks through georef.json. Roads without a confident match have no label and buildings without one keep their generated name; the old planning labels are kept in planName/planAddress.'
writeFileSync(resolve(assetDir, 'road-network.json'), JSON.stringify(network))

console.log(`roads: ${namedRoads}/${zone.roads.length} real street names`)
console.log(`buildings: ${counts.place} named places, ${counts.address} by address, ${counts.plan} kept planning labels (of ${zone.buildings.length})`)
console.log(`notable places (${famous.length}): ${famous.slice(0, 40).join(' · ')}`)
