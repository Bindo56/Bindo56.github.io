// Build the Nju Jork world from real Manhattan geometry in Minecraft block style.
// Island outline, streets, sidewalks, parks and building footprints come from OpenStreetMap; where the
// original Minecraft build has a building at the same real spot, its blocks (roof colours, setbacks,
// heights) are copied into the real footprint. Elsewhere buildings are generated at their OSM height.
// The new world is a scaled, rotated copy of real Manhattan: 3 m per block, avenues north-south,
// pinned so Times Square stays where it was in the Minecraft world.
//
// Inputs:  .cache/manhattan-osm/*.json        (node scripts/fetch-manhattan-osm.mjs)
//          .cache/nju-jork-minecraft/          (original Minecraft tiles, manifest, road network, georef)
// Outputs: public/assets/nju-jork/ tiles (d./dh. detail, r./h. standard), city-overview.jpg,
//          manifest.json, road-network.json, georef.json
// Run: node scripts/build-real-nju-jork.mjs   (Node 23.6+; imports the TypeScript georef module)
// Testing: --out=<dir> writes somewhere else, --bands=<n> uses only the first n OSM download bands.
// Map data © OpenStreetMap contributors, ODbL.

import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { createGeoref } from '../src/worlds/georef.ts'

const root = resolve(import.meta.dirname, '..')
const osmDir = resolve(root, '.cache/manhattan-osm')
const sourceDir = resolve(root, '.cache/nju-jork-minecraft')
const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1]
const outDir = resolve(root, option('out') ?? 'public/assets/nju-jork')
if (!existsSync(resolve(sourceDir, 'manifest.json'))) throw new Error('Missing .cache/nju-jork-minecraft backup of the original Minecraft tiles.')

const METERS_PER_BLOCK = 3
const ROAD_WIDTH_SCALE = 1.35
const GRID_BEARING = 29
const TILE = 512
const BASE_Y = 6
const GROUND = BASE_Y + 1
const NORTH_EDGE = -1024
const TIMES_SQUARE = { lat: 40.758, lon: -73.9855 }

// ---------- frames ----------

const LAT0 = 40.75
const LON0 = -73.985
const M_LON = Math.cos((LAT0 * Math.PI) / 180) * 111_320
const M_LAT = 110_574
const toEN = (lat, lon) => [(lon - LON0) * M_LON, (lat - LAT0) * M_LAT]
const fromEN = ([e, n]) => ({ lat: LAT0 + n / M_LAT, lon: LON0 + e / M_LON })
const cos = Math.cos((GRID_BEARING * Math.PI) / 180)
const sin = Math.sin((GRID_BEARING * Math.PI) / 180)

const oldGeoref = createGeoref(JSON.parse(readFileSync(resolve(sourceDir, 'georef.json'), 'utf8')).points)
const anchorOld = oldGeoref.toWorld(TIMES_SQUARE)
const anchorEN = toEN(TIMES_SQUARE.lat, TIMES_SQUARE.lon)
const rotate = ([e, n]) => [e * cos - n * sin, e * sin + n * cos]
const [ae, an] = rotate(anchorEN)
const TX = anchorOld.x - ae / METERS_PER_BLOCK
const TZ = anchorOld.z + an / METERS_PER_BLOCK
const enToWorld = (en) => {
  const [e, n] = rotate(en)
  return [e / METERS_PER_BLOCK + TX, -n / METERS_PER_BLOCK + TZ]
}
const worldToEN = (x, z) => {
  const e = (x - TX) * METERS_PER_BLOCK
  const n = -(z - TZ) * METERS_PER_BLOCK
  return [e * cos + n * sin, -e * sin + n * cos]
}
const geoToWorld = (lat, lon) => enToWorld(toEN(lat, lon))

// ---------- OSM input ----------

const readLayer = (name) => JSON.parse(readFileSync(resolve(osmDir, `${name}.json`), 'utf8')).elements
const bands = Math.min(Number(option('bands') ?? Infinity), readdirSync(osmDir).filter((file) => /^highways-\d+\.json$/.test(file)).length)
if (!bands) throw new Error('No OSM data in .cache/manhattan-osm; run node scripts/fetch-manhattan-osm.mjs first.')
const dedupe = (elements) => [...new Map(elements.map((element) => [`${element.type}/${element.id}`, element])).values()]
const highways = dedupe(Array.from({ length: bands }, (_, i) => readLayer(`highways-${i}`)).flat())
const buildingsOsm = dedupe(Array.from({ length: bands }, (_, i) => readLayer(`buildings-${i}`)).flat())
const areas = readLayer('areas')
const island = readLayer('island')

/** All edges of an element in world coordinates; even-odd filling needs no ring assembly. */
function worldLines(element) {
  if (element.geometry) return [element.geometry.map(({ lat, lon }) => geoToWorld(lat, lon))]
  if (element.members) return element.members.filter((member) => member.geometry).map((member) => member.geometry.map(({ lat, lon }) => geoToWorld(lat, lon)))
  return []
}

// ---------- raster ----------

const islandLines = island.flatMap(worldLines)
const islandPoints = islandLines.flat()
const tileMin = (value) => Math.floor(value / TILE)
const minRx = tileMin(Math.min(...islandPoints.map((p) => p[0])) - 96)
const maxRx = tileMin(Math.max(...islandPoints.map((p) => p[0])) + 96)
const minRz = tileMin(NORTH_EDGE)
const maxRz = tileMin(Math.max(...islandPoints.map((p) => p[1])) + 96)
const originX = minRx * TILE
const originZ = minRz * TILE
const W = (maxRx - minRx + 1) * TILE
const H = (maxRz - minRz + 1) * TILE
console.log(`world ${W}×${H} blocks, tiles x ${minRx}..${maxRx}, z ${minRz}..${maxRz}`)

const CLS = { water: 1, ground: 2, green: 3, walk: 4, road: 5, building: 6 }
const cls = new Uint8Array(W * H).fill(CLS.water)
const owner = new Int32Array(W * H)
const rgb = new Uint8Array(W * H * 3)
const height = new Uint8Array(W * H).fill(GROUND)

function fillPolygon(lines, paint) {
  const edges = []
  let top = Infinity
  let bottom = -Infinity
  for (const line of lines) for (let i = 1; i < line.length; i += 1) {
    const [xa, za] = [line[i - 1][0] - originX, line[i - 1][1] - originZ]
    const [xb, zb] = [line[i][0] - originX, line[i][1] - originZ]
    if (za === zb) continue
    edges.push(xa, za, xb, zb)
    top = Math.min(top, za, zb)
    bottom = Math.max(bottom, za, zb)
  }
  const crossings = []
  for (let row = Math.max(0, Math.floor(top)); row <= Math.min(H - 1, Math.ceil(bottom)); row += 1) {
    const zc = row + 0.5
    crossings.length = 0
    for (let k = 0; k < edges.length; k += 4) {
      const za = edges[k + 1]
      const zb = edges[k + 3]
      if ((za <= zc) !== (zb <= zc)) crossings.push(edges[k] + ((zc - za) * (edges[k + 2] - edges[k])) / (zb - za))
    }
    crossings.sort((a, b) => a - b)
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(crossings[k] - 0.5))
      const to = Math.min(W - 1, Math.floor(crossings[k + 1] - 0.5))
      for (let col = from; col <= to; col += 1) paint(row * W + col)
    }
  }
}

function strokeLine(points, width, paint) {
  const radius = Math.max(0.5, width / 2)
  for (let i = 1; i < points.length; i += 1) {
    const [xa, za] = points[i - 1]
    const [xb, zb] = points[i]
    const length = Math.hypot(xb - xa, zb - za)
    if (!length) continue
    const nx = (-(zb - za) / length) * radius
    const nz = ((xb - xa) / length) * radius
    fillPolygon([[[xa + nx, za + nz], [xb + nx, zb + nz], [xb - nx, zb - nz], [xa - nx, za - nz], [xa + nx, za + nz]]], paint)
  }
  if (radius < 1) return
  for (const [x, z] of points) {
    const cx = x - originX
    const cz = z - originZ
    for (let row = Math.max(0, Math.floor(cz - radius)); row <= Math.min(H - 1, Math.ceil(cz + radius)); row += 1)
      for (let col = Math.max(0, Math.floor(cx - radius)); col <= Math.min(W - 1, Math.ceil(cx + radius)); col += 1)
        if ((col + 0.5 - cx) ** 2 + (row + 0.5 - cz) ** 2 <= radius * radius) paint(row * W + col)
  }
}

const COLOURS = {
  water: [43, 87, 116], ground: [126, 124, 116], green: [93, 124, 66], wood: [62, 98, 46],
  walk: [150, 150, 150], road: [0, 0, 0], tank: [118, 84, 52], entrance: [38, 92, 56],
}
const setColour = (index, colour) => { rgb[index * 3] = colour[0]; rgb[index * 3 + 1] = colour[1]; rgb[index * 3 + 2] = colour[2] }
const onLand = (index) => cls[index] !== CLS.water

// 1. Island land (everything else stays water).
fillPolygon(islandLines, (index) => { cls[index] = CLS.ground })

// 2. Parks and greenery, 3. ponds and lakes.
for (const area of areas) {
  const tags = area.tags ?? {}
  const water = tags.natural === 'water'
  const wood = tags.natural === 'wood' || tags.landuse === 'forest'
  fillPolygon(worldLines(area), (index) => {
    if (water) { if (onLand(index)) cls[index] = CLS.water }
    else if (cls[index] === CLS.ground) { cls[index] = CLS.green; owner[index] = wood ? -1 : 0 }
  })
}

// 4. Building footprints.
const buildings = []
for (const element of buildingsOsm) {
  const tags = element.tags ?? {}
  if (!tags.building || tags.building === 'roof' || tags.building === 'construction' || tags.location === 'underground') continue
  const index = buildings.length
  const record = { element, tags, pixels: [] }
  fillPolygon(worldLines(element), (pixel) => {
    if (cls[pixel] === CLS.ground || cls[pixel] === CLS.green) {
      cls[pixel] = CLS.building
      owner[pixel] = index + 1
    }
  })
  buildings.push(record)
}

// 5. Streets: sidewalk bands and footpaths first, then black carriageways over everything on land.
const CARRIAGEWAY = {
  motorway: 14, trunk: 13, primary: 15, secondary: 12, tertiary: 11, unclassified: 8, residential: 9.5, living_street: 6,
  road: 8, service: 4.5, motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 7,
}
const NO_SIDEWALK = new Set(['motorway', 'trunk', 'service', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'])
const WALKWAYS = new Set(['footway', 'pedestrian', 'path', 'steps', 'cycleway', 'track', 'bridleway', 'corridor'])
const SIDEWALK_METERS = 5.5
const metres = (value) => { const number = parseFloat(value); return Number.isFinite(number) ? number : null }
/** OSM lengths: plain numbers are metres, but NYC data often uses feet ("69.6 ft", 33'4"). */
function lengthMetres(value) {
  if (value === undefined) return null
  const text = String(value).trim().toLowerCase()
  const feetInches = /^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/.exec(text)
  if (feetInches) return Number(feetInches[1]) * 0.3048 + Number(feetInches[2] ?? 0) * 0.0254
  const plain = /^(\d+(?:\.\d+)?)\s*(m|ft|feet|foot)?$/.exec(text)
  if (!plain) return null
  return Number(plain[1]) * (plain[2] && plain[2] !== 'm' ? 0.3048 : 1)
}
const clampWidth = (value, max) => (value === null ? null : Math.min(max, value))
const usable = (tags) => !(tags.tunnel && tags.tunnel !== 'no') && tags.covered !== 'yes' && !(Number(tags.layer) < 0) && tags.indoor !== 'yes'
  && !['construction', 'proposed', 'platform', 'elevator', 'abandoned', 'razed'].includes(tags.highway)

const streets = []
const paths = []
const plazas = []
for (const way of highways) {
  const tags = way.tags ?? {}
  if (!usable(tags)) continue
  const points = worldLines(way)[0]
  if (!points || points.length < 2) continue
  if (tags.area === 'yes' && (tags.highway === 'pedestrian' || tags.highway === 'footway')) plazas.push(points)
  else if (CARRIAGEWAY[tags.highway]) {
    const width = clampWidth(lengthMetres(tags.width), 30) ?? (metres(tags.lanes) ? Math.min(30, metres(tags.lanes) * 3.3) : CARRIAGEWAY[tags.highway])
    streets.push({ way, tags, points, width: width * ROAD_WIDTH_SCALE / METERS_PER_BLOCK, sidewalk: !NO_SIDEWALK.has(tags.highway) })
  } else if (WALKWAYS.has(tags.highway) || tags.footway === 'crossing' || tags.cycleway === 'crossing') {
    paths.push({ way, points, tags, width: Math.max(1, (clampWidth(lengthMetres(tags.width), 10) ?? (tags.highway === 'pedestrian' ? 6 : 2.5)) / METERS_PER_BLOCK) })
  }
}
const walkable = (index) => cls[index] === CLS.ground || cls[index] === CLS.green
// area:highway polygons give exact surfaces: plazas (Times Square), sidewalk areas, islands, road areas.
const surfaces = existsSync(resolve(osmDir, 'surfaces.json')) ? readLayer('surfaces') : []
const WALK_SURFACES = new Set(['pedestrian', 'footway', 'sidewalk', 'steps', 'cycleway', 'traffic_island', 'crossing'])
for (const surface of surfaces) {
  if (WALK_SURFACES.has(surface.tags?.['area:highway'])) fillPolygon(worldLines(surface), (index) => { if (walkable(index)) cls[index] = CLS.walk })
}
for (const points of plazas) fillPolygon([points], (index) => { if (walkable(index)) cls[index] = CLS.walk })
for (const street of streets) if (street.sidewalk) strokeLine(street.points, street.width + (2 * SIDEWALK_METERS) / METERS_PER_BLOCK, (index) => { if (walkable(index)) cls[index] = CLS.walk })
for (const path of paths) strokeLine(path.points, path.width, (index) => {
  if (!walkable(index) && cls[index] !== CLS.walk) return
  cls[index] = CLS.walk
})
for (const street of streets) strokeLine(street.points, Math.max(1, street.width), (index) => {
  if (!onLand(index)) return
  cls[index] = CLS.road
  owner[index] = 0
})
for (const surface of surfaces) {
  const kind = surface.tags?.['area:highway']
  if (!CARRIAGEWAY[kind] && kind !== 'yes') continue
  fillPolygon(worldLines(surface), (index) => {
    if (!onLand(index) || cls[index] === CLS.building) return
    cls[index] = CLS.road
  })
}

// OSM bridge ways are separate from the island outline. Restore their decks over water;
// cycleways and footways share the same grey walking surface, never a bike-lane colour.
const BRIDGE_RISE = 5
// Midpoints of the gaps at the two OSM Brooklyn Bridge Promenade tower portals.
const brooklynTowers = [[40.7072707, -73.9983383], [40.7041045, -73.9943531]]
  .map(([lat, lon]) => geoToWorld(lat, lon).map((value) => Math.round(value * 10) / 10))
const brooklynDx = brooklynTowers[1][0] - brooklynTowers[0][0]
const brooklynDz = brooklynTowers[1][1] - brooklynTowers[0][1]
const brooklynLength = Math.hypot(brooklynDx, brooklynDz)
const brooklynAlong = (x, z) => ((x - brooklynTowers[0][0]) * brooklynDx + (z - brooklynTowers[0][1]) * brooklynDz) / brooklynLength
const brooklynAcross = (x, z) => ((x - brooklynTowers[0][0]) * brooklynDz - (z - brooklynTowers[0][1]) * brooklynDx) / brooklynLength
const underBrooklynBridge = (x, z) => brooklynAlong(x, z) > -45 && brooklynAlong(x, z) < brooklynLength + 45 && Math.abs(brooklynAcross(x, z)) < 22
const isBridge = (tags) => Boolean(tags.bridge && tags.bridge !== 'no')
const bridgeWays = [...streets, ...paths].filter((way) => isBridge(way.tags))
const nearIsland = (x, z) => {
  const col = Math.floor(x - originX)
  const row = Math.floor(z - originZ)
  for (const dz of [-8, 0, 8]) for (const dx of [-8, 0, 8]) {
    const c = col + dx
    const r = row + dz
    if (c >= 0 && r >= 0 && c < W && r < H && cls[r * W + c] !== CLS.water) return true
  }
  return false
}
// The OSM download also contains bridges in nearby boroughs. Keep only connected
// bridge ways whose network reaches this Manhattan island, so no stray spans float in water.
const bridgeByNode = new Map()
for (let i = 0; i < bridgeWays.length; i += 1) {
  for (const { lat, lon } of bridgeWays[i].way.geometry ?? []) {
    const key = `${lat},${lon}`
    if (!bridgeByNode.has(key)) bridgeByNode.set(key, [])
    bridgeByNode.get(key).push(i)
  }
}
const selectedBridges = new Set()
const bridgeQueue = []
for (let i = 0; i < bridgeWays.length; i += 1) {
  if (!bridgeWays[i].points.some(([x, z]) => nearIsland(x, z))) continue
  selectedBridges.add(i)
  bridgeQueue.push(i)
}
for (let head = 0; head < bridgeQueue.length; head += 1) {
  for (const { lat, lon } of bridgeWays[bridgeQueue[head]].way.geometry ?? []) {
    for (const next of bridgeByNode.get(`${lat},${lon}`) ?? []) {
      if (selectedBridges.has(next)) continue
      selectedBridges.add(next)
      bridgeQueue.push(next)
    }
  }
}
const selectedWays = bridgeWays.filter((_, i) => selectedBridges.has(i))
const bridgeStreets = selectedWays.filter((way) => CARRIAGEWAY[way.tags.highway])
const bridgePaths = selectedWays.filter((way) => !CARRIAGEWAY[way.tags.highway])
const waterAt = (x, z) => {
  const col = Math.floor(x - originX)
  const row = Math.floor(z - originZ)
  return col >= 0 && row >= 0 && col < W && row < H && cls[row * W + col] === CLS.water
}
const bridgePiers = []
const pierCells = new Set()
for (const street of bridgeStreets) for (let j = 1; j < street.points.length; j += 1) {
  const [xa, za] = street.points[j - 1]
  const [xb, zb] = street.points[j]
  const length = Math.hypot(xb - xa, zb - za)
  const samples = Math.max(1, Math.ceil(length / 24))
  for (let sample = 0; sample < samples; sample += 1) {
    const t = (sample + 0.5) / samples
    const x = xa + (xb - xa) * t
    const z = za + (zb - za) * t
    if (!waterAt(x, z) || underBrooklynBridge(x, z)) continue
    const cell = `${Math.round(x / 24)},${Math.round(z / 24)}`
    if (pierCells.has(cell)) continue
    pierCells.add(cell)
    bridgePiers.push([Math.round(x), Math.round(z), BRIDGE_RISE])
  }
}
const bridgePixel = (index) => cls[index] === CLS.water || height[index] > GROUND
const raiseBridge = (index, surface) => {
  if (!bridgePixel(index)) return
  cls[index] = surface
  height[index] = GROUND + BRIDGE_RISE
  owner[index] = 0
}
for (const street of bridgeStreets) if (street.sidewalk) {
  strokeLine(street.points, street.width + (2 * SIDEWALK_METERS) / METERS_PER_BLOCK,
    (index) => raiseBridge(index, CLS.walk))
}
for (const path of bridgePaths) strokeLine(path.points, path.width, (index) => raiseBridge(index, CLS.walk))
for (const street of bridgeStreets) {
  strokeLine(street.points, Math.max(1, street.width), (index) => raiseBridge(index, CLS.road))
}
console.log(`bridge spans: ${bridgeStreets.length} road ways, ${bridgePaths.length} walking ways, ${bridgePiers.length} supports`)

// ---------- Minecraft models ----------

const sourceManifest = JSON.parse(readFileSync(resolve(sourceDir, 'manifest.json'), 'utf8'))
const sourceZone = sourceManifest.zones.find((zone) => zone.id === 'city')
// The whole Minecraft city in one flat array, so building matching can sample it millions of times.
const [sx0, sz0, sx1, sz1] = sourceZone.bounds
const SW = sx1 - sx0
const SH = sz1 - sz0
const srcColour = new Uint8Array(SW * SH * 3)
const srcHeight = new Uint8Array(SW * SH)
for (const [rx, rz] of sourceZone.tiles) {
  const colour = PNG.sync.read(readFileSync(resolve(sourceDir, `d.${rx}.${rz}.png`))).data
  const heights = PNG.sync.read(readFileSync(resolve(sourceDir, `dh.${rx}.${rz}.png`))).data
  for (let pz = 0; pz < TILE; pz += 1) for (let px = 0; px < TILE; px += 1) {
    const wx = rx * TILE + px - sx0
    const wz = rz * TILE + pz - sz0
    if (wx < 0 || wz < 0 || wx >= SW || wz >= SH) continue
    const o = (pz * TILE + px) * 4
    const j = wz * SW + wx
    srcColour[j * 3] = colour[o]; srcColour[j * 3 + 1] = colour[o + 1]; srcColour[j * 3 + 2] = colour[o + 2]
    srcHeight[j] = heights[o]
  }
}
const sourceIndex = (x, z) => {
  const bx = Math.round(x) - sx0
  const bz = Math.round(z) - sz0
  return bx < 0 || bz < 0 || bx >= SW || bz >= SH ? -1 : bz * SW + bx
}
const sourceRgb = (j) => [srcColour[j * 3], srcColour[j * 3 + 1], srcColour[j * 3 + 2]]

// The old mapping is smooth, so evaluate it every 8 blocks and interpolate in between.
const STRIDE = 8
const gw = Math.ceil(W / STRIDE) + 1
const gh = Math.ceil(H / STRIDE) + 1
const oldX = new Float32Array(gw * gh)
const oldZ = new Float32Array(gw * gh)
for (let gz = 0; gz < gh; gz += 1) for (let gx = 0; gx < gw; gx += 1) {
  const old = oldGeoref.toWorld(fromEN(worldToEN(originX + gx * STRIDE + 0.5, originZ + gz * STRIDE + 0.5)))
  oldX[gz * gw + gx] = old.x
  oldZ[gz * gw + gx] = old.z
}
function oldWorldAt(index) {
  const col = index % W
  const row = (index - col) / W
  const fx = col / STRIDE
  const fz = row / STRIDE
  const x0 = Math.floor(fx)
  const z0 = Math.floor(fz)
  const tx = fx - x0
  const tz = fz - z0
  const at = (grid, x, z) => grid[z * gw + x]
  const lerp = (grid) => (at(grid, x0, z0) * (1 - tx) + at(grid, x0 + 1, z0) * tx) * (1 - tz) + (at(grid, x0, z0 + 1) * (1 - tx) + at(grid, x0 + 1, z0 + 1) * tx) * tz
  return [lerp(oldX), lerp(oldZ)]
}
// A real footprint reuses the Minecraft blocks when at least this share of it lands on Minecraft building blocks.
const MINECRAFT_SHARE = 0.3
const isBuilt = (j) => j >= 0 && srcHeight[j] >= GROUND + 3
const isGreen = (j) => j >= 0 && srcColour[j * 3 + 1] > srcColour[j * 3] + 8 && srcColour[j * 3 + 1] > srcColour[j * 3 + 2] + 8
// Minecraft builders placed buildings up to a few dozen metres off; slide each footprint this far to find its match.
const SEARCH_BLOCKS = 10

// ---------- colours and heights ----------

const PALETTE = [
  [157, 157, 151], [125, 125, 125], [150, 97, 83], [152, 94, 67], [207, 213, 214], [54, 57, 61],
  [216, 203, 155], [160, 166, 179], [230, 226, 218], [86, 91, 91], [114, 108, 98], [176, 120, 96],
]
const hash = (value) => { let h = 2166136261; for (const char of String(value)) h = Math.imul(h ^ char.charCodeAt(0), 16777619); return h >>> 0 }
function osmHeightBlocks(tags) {
  const metresTall = lengthMetres(tags.height) ?? (metres(tags['building:levels']) !== null ? metres(tags['building:levels']) * 3.4 + 2 : null)
    ?? ({ house: 10, detached: 10, garage: 4, shed: 3, kiosk: 3, church: 22, cathedral: 40 }[tags.building] ?? 18)
  return Math.max(2, Math.min(255 - GROUND, Math.round(metresTall / METERS_PER_BLOCK)))
}

for (let i = 0; i < W * H; i += 1) {
  if (cls[i] === CLS.water) setColour(i, COLOURS.water)
  else if (cls[i] === CLS.ground) setColour(i, COLOURS.ground)
  else if (cls[i] === CLS.walk) setColour(i, COLOURS.walk)
  else if (cls[i] === CLS.road) setColour(i, COLOURS.road)
  else if (cls[i] === CLS.green) {
    // Keep grass/woodland as ground. Tree trunks and crowns are separate 3D blocks below.
    setColour(i, owner[i] === -1 ? COLOURS.wood : COLOURS.green)
  }
}

const byBuilding = buildings.map(() => [])
for (let i = 0; i < W * H; i += 1) if (cls[i] === CLS.building) byBuilding[owner[i] - 1].push(i)
let minecraftBuildings = 0
buildings.forEach((building, index) => {
  const pixels = byBuilding[index]
  building.pixels = pixels.length
  if (!pixels.length) return
  const old = pixels.map((pixel) => oldWorldAt(pixel))
  const step = Math.max(1, Math.floor(pixels.length / 80))
  const probe = old.filter((_, k) => k % step === 0)
  const share = (dx, dz) => { let hits = 0; for (const [x, z] of probe) if (isBuilt(sourceIndex(x + dx, z + dz))) hits += 1; return hits / probe.length }
  // Best overlap wins, with a small penalty per block of shift so the nearest good match is chosen.
  let best = { dx: 0, dz: 0, share: share(0, 0), score: share(0, 0) }
  const consider = (dx, dz) => { const value = share(dx, dz); const score = value - 0.004 * Math.hypot(dx, dz); if (score > best.score) best = { dx, dz, share: value, score } }
  for (let dz = -SEARCH_BLOCKS; dz <= SEARCH_BLOCKS; dz += 2) for (let dx = -SEARCH_BLOCKS; dx <= SEARCH_BLOCKS; dx += 2) consider(dx, dz)
  const coarse = { ...best }
  for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) consider(coarse.dx + dx, coarse.dz + dz)
  const samples = old.map(([x, z]) => sourceIndex(x + best.dx, z + best.dz))
  const built = samples.filter(isBuilt)
  building.builtFraction = built.length / pixels.length
  building.minecraft = building.builtFraction >= MINECRAFT_SHARE
  let roofHeight = osmHeightBlocks(building.tags)
  if (building.minecraft) {
    minecraftBuildings += 1
    const sorted = built.map((j) => srcHeight[j]).sort((a, b) => a - b)
    const fillHeight = sorted[sorted.length >> 1]
    const counts = new Map()
    for (const j of built) { const key = sourceRgb(j).join(','); counts.set(key, (counts.get(key) ?? 0) + 1) }
    const fillColour = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number)
    pixels.forEach((pixel, k) => {
      const j = samples[k]
      if (isBuilt(j)) { setColour(pixel, sourceRgb(j)); height[pixel] = srcHeight[j] }
      else { setColour(pixel, fillColour); height[pixel] = fillHeight }
    })
    roofHeight = sorted[sorted.length - 1] - GROUND
  } else {
    const colour = PALETTE[hash(building.element.id) % PALETTE.length]
    const blocks = osmHeightBlocks(building.tags)
    for (const pixel of pixels) { setColour(pixel, colour); height[pixel] = GROUND + blocks }
    // New York rooftop water tanks on many mid-rise buildings: one wooden block two high.
    if (blocks >= 5 && blocks <= 30 && pixels.length >= 16 && hash(`tank${building.element.id}`) % 100 < 45) {
      const cx = pixels.reduce((sum, pixel) => sum + (pixel % W), 0) / pixels.length
      const cz = pixels.reduce((sum, pixel) => sum + Math.floor(pixel / W), 0) / pixels.length
      const interior = pixels.filter((pixel) => [1, -1, W, -W].every((step) => owner[pixel + step] === index + 1))
      const spot = interior.sort((a, b) => Math.hypot((a % W) - cx, Math.floor(a / W) - cz) - Math.hypot((b % W) - cx, Math.floor(b / W) - cz))[0]
      if (spot !== undefined) { setColour(spot, COLOURS.tank); height[spot] = GROUND + blocks + 2 }
    }
  }
  building.roofBlocks = roofHeight
})
console.log(`buildings: ${buildings.filter((b) => b.pixels).length} drawn, ${minecraftBuildings} using Minecraft models`)

// ---------- street furniture: real street trees and subway entrances ----------

const furniture = existsSync(resolve(osmDir, 'furniture.json')) ? readLayer('furniture') : []
const pixelAt = (x, z) => {
  const col = Math.floor(x - originX)
  const row = Math.floor(z - originZ)
  return col >= 0 && row >= 0 && col < W && row < H ? row * W + col : -1
}
const canHost = (index) => index >= 0 && (cls[index] === CLS.walk || cls[index] === CLS.ground || cls[index] === CLS.green)
  && height[index] <= GROUND
/** The spot itself, or a sidewalk/grass neighbour when widened roads cover an inventory point. */
function hostNear(x, z) {
  const index = pixelAt(x, z)
  if (canHost(index)) return index
  for (let radius = 1; radius <= 5; radius += 1)
    for (let dz = -radius; dz <= radius; dz += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue
      const nearby = pixelAt(x + dx, z + dz)
      if (canHost(nearby)) return nearby
    }
  return -1
}
// Shapes: London plane, honeylocust, Callery pear, pin oak, ginkgo, mixed broadleaf.
const treeKind = (name) => {
  if (/Platanus/i.test(name)) return 0
  if (/Gleditsia/i.test(name)) return 1
  if (/Pyrus/i.test(name)) return 2
  if (/Quercus/i.test(name)) return 3
  if (/Ginkgo/i.test(name)) return 4
  return 5
}
const treeTiles = new Map()
const occupiedTrees = new Map()
const treeStats = new Map()
const treesInTile = (x, z) => {
  const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`
  if (!treeTiles.has(key)) treeTiles.set(key, [])
  return treeTiles.get(key)
}
const addTree = (index, kind, size, source) => {
  if (!canHost(index)) return false
  const x = originX + (index % W) + .5
  const z = originZ + Math.floor(index / W) + .5
  const cellX = Math.floor(x / 3)
  const cellZ = Math.floor(z / 3)
  for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1)
    for (const [px, pz] of occupiedTrees.get(`${cellX + dx},${cellZ + dz}`) ?? [])
      if (Math.hypot(px - x, pz - z) < 2.7) return false
  const cell = `${cellX},${cellZ}`
  if (!occupiedTrees.has(cell)) occupiedTrees.set(cell, [])
  occupiedTrees.get(cell).push([x, z])
  treesInTile(x, z).push([x, z, kind, Math.round(size * 100) / 100])
  treeStats.set(source, (treeStats.get(source) ?? 0) + 1)
  return true
}
let entrances = 0
const plantTree = (x, z, kind, size, source) => {
  const index = hostNear(x, z)
  if (index >= 0) addTree(index, kind, size, source)
}
const forestryFile = resolve(osmDir, 'forestry-trees.json')
const forestry = existsSync(forestryFile) ? JSON.parse(readFileSync(forestryFile, 'utf8')) : null
if (forestry) for (const tree of forestry.trees) {
  const [lon, lat] = tree.location.coordinates
  const dbh = Number(tree.dbh) || 0
  plantTree(...geoToWorld(lat, lon), treeKind(tree.genusspecies ?? ''), Math.max(.7, Math.min(1.5, .72 + dbh / 30)), 'NYC Parks')
}
for (const element of furniture) {
  const tags = element.tags ?? {}
  if (tags.natural === 'tree' && element.lat !== undefined && !forestry)
    plantTree(...geoToWorld(element.lat, element.lon), hash(element.id) % 6, 1, 'OpenStreetMap')
  else if (tags.natural === 'tree_row') {
    const line = worldLines(element)[0] ?? []
    for (let i = 1; i < line.length; i += 1) {
      const length = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
      if (!forestry) for (let t = 0; t < length; t += 3) plantTree(line[i - 1][0] + ((line[i][0] - line[i - 1][0]) * t) / length,
        line[i - 1][1] + ((line[i][1] - line[i - 1][1]) * t) / length, hash(`${element.id}:${i}:${t}`) % 6, 1, 'OpenStreetMap')
    }
  } else if (tags.railway === 'subway_entrance' && element.lat !== undefined) {
    const index = hostNear(...geoToWorld(element.lat, element.lon))
    if (index >= 0) { setColour(index, COLOURS.entrance); height[index] = GROUND + 1; entrances += 1 }
  }
}
// Central Park and other green OSM polygons lack a complete point inventory. Preserve the old
// Minecraft canopy as a density cue, while leaving open lawns largely open for street-level views.
const PARK_SPECIES = [0, 0, 1, 1, 2, 3, 3, 4, 5, 5]
for (let z = 0; z < H; z += 7) for (let x = 0; x < W; x += 7) {
  const seed = hash(`${x}:${z}`)
  const col = Math.min(W - 1, x + seed % 5)
  const row = Math.min(H - 1, z + ((seed >>> 4) % 5))
  const index = row * W + col
  if (cls[index] !== CLS.green || !canHost(index)) continue
  const old = sourceIndex(...oldWorldAt(index))
  const modeledCanopy = isGreen(old) && srcHeight[old] >= GROUND + 2
  const chance = owner[index] === -1 ? 95 : modeledCanopy ? 85 : 65
  if ((seed >>> 8) % 100 >= chance) continue
  addTree(index, PARK_SPECIES[(seed >>> 16) % PARK_SPECIES.length], .8 + ((seed >>> 24) % 55) / 100, 'park/woodland')
}
console.log(`trees: ${[...treeStats].map(([source, count]) => `${count} ${source}`).join(', ')}; ${entrances} subway entrances`)

// ---------- tiles and overview ----------

const tiles = []
for (const file of readdirSync(outDir)) if (/^(d|dh|r|h)\.-?\d+\.-?\d+\.png$/.test(file) || /^trees\.-?\d+\.-?\d+\.json$/.test(file) || file === 'detached-overview.jpg') rmSync(resolve(outDir, file))
const writePng = (file, width, data, colorType) => {
  const png = new PNG({ width, height: width, colorType, inputColorType: 6 })
  png.data = data
  writeFileSync(resolve(outDir, file), PNG.sync.write(png, { colorType, inputColorType: 6 }))
}
for (let rz = minRz; rz <= maxRz; rz += 1) for (let rx = minRx; rx <= maxRx; rx += 1) {
  writeFileSync(resolve(outDir, `trees.${rx}.${rz}.json`), JSON.stringify(treeTiles.get(`${rx},${rz}`) ?? []))
  const detail = Buffer.alloc(TILE * TILE * 4)
  const detailHeight = Buffer.alloc(TILE * TILE * 4)
  const half = TILE / 2
  const coarse = Buffer.alloc(half * half * 4)
  const coarseHeight = Buffer.alloc(half * half * 4)
  const left = (rx - minRx) * TILE
  const top = (rz - minRz) * TILE
  for (let z = 0; z < TILE; z += 1) for (let x = 0; x < TILE; x += 1) {
    const i = (top + z) * W + left + x
    const o = (z * TILE + x) * 4
    detail[o] = rgb[i * 3]; detail[o + 1] = rgb[i * 3 + 1]; detail[o + 2] = rgb[i * 3 + 2]; detail[o + 3] = 255
    detailHeight[o] = detailHeight[o + 1] = detailHeight[o + 2] = height[i]; detailHeight[o + 3] = 255
  }
  // Standard tiles keep the tallest block of each 2×2 so towers stay visible from afar.
  for (let z = 0; z < half; z += 1) for (let x = 0; x < half; x += 1) {
    let best = (top + z * 2) * W + left + x * 2
    for (const [dx, dz] of [[1, 0], [0, 1], [1, 1]]) { const j = (top + z * 2 + dz) * W + left + x * 2 + dx; if (height[j] > height[best]) best = j }
    const o = (z * half + x) * 4
    coarse[o] = rgb[best * 3]; coarse[o + 1] = rgb[best * 3 + 1]; coarse[o + 2] = rgb[best * 3 + 2]; coarse[o + 3] = 255
    coarseHeight[o] = coarseHeight[o + 1] = coarseHeight[o + 2] = height[best]; coarseHeight[o + 3] = 255
  }
  writePng(`d.${rx}.${rz}.png`, TILE, detail, 2)
  writePng(`dh.${rx}.${rz}.png`, TILE, detailHeight, 0)
  writePng(`r.${rx}.${rz}.png`, half, coarse, 2)
  writePng(`h.${rx}.${rz}.png`, half, coarseHeight, 0)
  tiles.push([rx, rz])
}
const overview = Buffer.alloc((W / 2) * (H / 2) * 4)
for (let z = 0; z < H / 2; z += 1) for (let x = 0; x < W / 2; x += 1) {
  const i = z * 2 * W + x * 2
  const o = (z * (W / 2) + x) * 4
  overview[o] = rgb[i * 3]; overview[o + 1] = rgb[i * 3 + 1]; overview[o + 2] = rgb[i * 3 + 2]; overview[o + 3] = 255
}
writeFileSync(resolve(outDir, 'city-overview.jpg'), jpeg.encode({ data: overview, width: W / 2, height: H / 2 }, 85).data)

// ---------- road network ----------

const SHORT = [[/ Street$/, ' St'], [/ Avenue$/, ' Ave'], [/ Boulevard$/, ' Blvd'], [/ Place$/, ' Pl'], [/ Drive$/, ' Dr'], [/ Parkway$/, ' Pkwy'], [/ Road$/, ' Rd'], [/ Square$/, ' Sq'], [/ Lane$/, ' Ln'], [/ Highway$/, ' Hwy'], [/ Plaza$/, ' Plz']]
function shortName(name) {
  if (!name) return ''
  let short = name.split(' ').length >= 3 ? name.replace(/^(West|East|North|South) /, (match) => `${match[0]} `) : name
  for (const [pattern, replacement] of SHORT) short = short.replace(pattern, replacement)
  return short
}
const inside = (x, z) => {
  const col = Math.floor(x - originX)
  const row = Math.floor(z - originZ)
  return col >= 0 && row >= 0 && col < W && row < H && onLand(row * W + col) && z >= NORTH_EDGE
}
// Overpass geometry output carries no node IDs; ways that share an OSM node share its exact coordinates.
const graphWays = streets
  .filter((street) => street.way.tags.highway !== 'service' && street.way.geometry?.length === street.points.length)
  .map((street) => ({ ...street, keys: street.way.geometry.map(({ lat, lon }) => `${lat},${lon}`) }))
const useCount = new Map()
for (const { keys } of graphWays) keys.forEach((key, k) => {
  const weight = k === 0 || k === keys.length - 1 ? 2 : 1
  useCount.set(key, (useCount.get(key) ?? 0) + weight)
})
const nodeIds = new Map()
const nodes = []
const roads = []
const nodeFor = (osmNode, [x, z]) => {
  if (!nodeIds.has(osmNode)) {
    const id = `N${String(nodes.length + 1).padStart(5, '0')}`
    nodeIds.set(osmNode, id)
    nodes.push({ id, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, degree: 0 })
  }
  return nodeIds.get(osmNode)
}
for (const { way, points, keys, width, sidewalk } of graphWays) {
  let start = 0
  for (let k = 1; k < keys.length; k += 1) {
    if (k !== keys.length - 1 && (useCount.get(keys[k]) ?? 0) < 2) continue
    const segment = points.slice(start, k + 1)
    if (segment.some(([x, z]) => inside(x, z))) {
      const from = nodeFor(keys[start], points[start])
      const to = nodeFor(keys[k], points[k])
      let length = 0
      for (let j = 1; j < segment.length; j += 1) length += Math.hypot(segment[j][0] - segment[j - 1][0], segment[j][1] - segment[j - 1][1])
      roads.push({ id: `R${String(roads.length + 1).padStart(5, '0')}`, name: shortName(way.tags.name), fullName: way.tags.name ?? '', bridge: isBridge(way.tags), width: Math.round(width * 10) / 10, sidewalk, from, to, length: Math.round(length * 10) / 10, points: segment.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]) })
    }
    start = k
  }
}
const nodeById = new Map(nodes.map((node) => [node.id, node]))
for (const road of roads) { nodeById.get(road.from).degree += 1; nodeById.get(road.to).degree += 1 }
const usedNodes = nodes.filter((node) => node.degree > 0).map(({ degree, ...node }) => ({ ...node, kind: degree >= 3 ? 'intersection' : degree === 1 ? 'end' : 'corner' }))

// Building markers: named buildings first (notable ones lead), then larger buildings by street address.
const oldNetwork = JSON.parse(readFileSync(resolve(sourceDir, 'road-network.json'), 'utf8')).zones.city
const oldLandmarks = oldNetwork.buildings.filter((building) => building.nameSource === 'osm-place').map((building) => {
  const real = oldGeoref.toGeo({ x: building.x, z: building.z })
  const [x, z] = geoToWorld(real.lat, real.lon)
  return { id: building.id, name: building.name, x, z }
})
const markers = []
for (const building of buildings) {
  if (!building.pixels) continue
  const tags = building.tags
  const address = tags['addr:housenumber'] && tags['addr:street']
    ? `${tags['addr:housenumber']} ${shortName(tags['addr:street'])}, New York, NY${tags['addr:postcode'] ? ` ${tags['addr:postcode']}` : ''}` : null
  if (!tags.name && !(address && building.pixels >= 60)) continue
  const points = worldLines(building.element).flat()
  const xs = points.map((p) => p[0])
  const zs = points.map((p) => p[1])
  const x = Math.round((Math.min(...xs) + Math.max(...xs)) / 2)
  const z = Math.round((Math.min(...zs) + Math.max(...zs)) / 2)
  if (z < NORTH_EDGE) continue
  markers.push({
    id: `${building.element.type === 'way' ? 'W' : 'R'}${building.element.id}`,
    name: tags.name ?? address.split(',')[0],
    address: address ?? 'Manhattan, New York, NY',
    streetId: null,
    icon: 'building',
    x, z,
    roofY: BASE_Y + building.roofBlocks,
    areaBlocks: building.pixels,
    bounds: [Math.floor(Math.min(...xs)), Math.floor(Math.min(...zs)), Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...zs))],
    nameSource: tags.name ? 'osm-place' : 'osm-address',
    minecraft: building.minecraft,
    builtFraction: building.builtFraction,
    notable: Boolean(tags.wikidata || tags.wikipedia),
  })
}
// Keep the old landmark IDs (B0471 = Empire State Building, ...) that NPC code refers to.
let keptIds = 0
for (const landmark of oldLandmarks) {
  const match = markers
    .filter((marker) => marker.name === landmark.name)
    .map((marker) => ({ marker, distance: Math.hypot(marker.x - landmark.x, marker.z - landmark.z) }))
    .filter(({ distance }) => distance < 60)
    .sort((a, b) => a.distance - b.distance)[0]
  if (match && !/^B\d{4}$/.test(match.marker.id)) { match.marker.id = landmark.id; keptIds += 1 }
}
markers.sort((a, b) => Number(b.notable) - Number(a.notable) || Number(b.nameSource === 'osm-place') - Number(a.nameSource === 'osm-place') || b.areaBlocks - a.areaBlocks)
const debugIds = option('debug')?.split(',') ?? []
for (const marker of markers) if (debugIds.includes(marker.id)) console.log(`debug ${marker.id} ${marker.name}: ${Math.round(marker.builtFraction * 100)}% on Minecraft blocks, ${marker.areaBlocks} blocks`)
markers.forEach((marker) => { delete marker.notable; delete marker.builtFraction })

const roadNetwork = {
  version: 2,
  coordinateSystem: `World blocks: ${METERS_PER_BLOCK} m per block, rotated ${GRID_BEARING}° so Manhattan avenues run north-south (see georef.json)`,
  modes: ['car', 'pedestrian', 'npc'],
  zones: { city: { nodes: usedNodes, roads, buildings: markers } },
  labelSource: 'Streets, building footprints, names and addresses from OpenStreetMap (© OpenStreetMap contributors, ODbL). Building blocks reuse the Nju Jork Minecraft models where they exist.',
}
writeFileSync(resolve(outDir, 'road-network.json'), JSON.stringify(roadNetwork))

// ---------- manifest and exact mapping ----------

const startReal = oldGeoref.toGeo({ x: sourceZone.start[0], z: sourceZone.start[1] })
const start = geoToWorld(startReal.lat, startReal.lon).map(Math.round)
const bounds = [originX, originZ, originX + W, originZ + H]
const manifest = {
  source: 'OpenStreetMap (© OpenStreetMap contributors, ODbL) with Nju Jork 2024 07 Minecraft building models',
  step: 2, detailStep: 1, detailPixels: TILE, baseY: BASE_Y, tileBlocks: TILE, tilePixels: TILE / 2,
  roadNetwork: 'road-network.json', transitNetwork: 'transit-network.json', bridgeRise: BRIDGE_RISE, bridgePiers,
  brooklynBridge: { towers: brooklynTowers, deckRise: BRIDGE_RISE },
  parkFocus: geoToWorld(40.7712, -73.9742).map((value) => Math.round(value)),
  trees: { source: forestry ? `${forestry.source}; fetched ${forestry.fetchedAt}` : 'OpenStreetMap tree points',
    parkPlacement: 'OpenStreetMap green polygons and original Minecraft canopy density', count: [...treeStats.values()].reduce((a, b) => a + b, 0) },
  roadWidthBlocks: Math.round(CARRIAGEWAY.residential * ROAD_WIDTH_SCALE / METERS_PER_BLOCK),
  footpathWidthBlocks: Math.round(SIDEWALK_METERS / METERS_PER_BLOCK), metersPerBlock: METERS_PER_BLOCK,
  zones: [{ id: 'city', name: 'Nju Jork', bounds, start, overview: 'city-overview.jpg', tiles }],
}
writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

// The world is an exact similarity of real coordinates; a 3×3 grid of points reproduces it exactly.
const frame = []
for (const fz of [0.15, 0.5, 0.85]) for (const fx of [0.15, 0.5, 0.85]) {
  const x = Math.round(originX + W * fx)
  const z = Math.round(originZ + H * fz)
  const { lat, lon } = fromEN(worldToEN(x, z))
  frame.push(`    { "id": "frame-${frame.length + 1}", "label": "Frame point ${frame.length + 1}", "world": [${x}, ${z}], "geo": [${lat.toFixed(7)}, ${lon.toFixed(7)}], "source": "exact (generated map)" }`)
}
writeFileSync(resolve(outDir, 'georef.json'), `{\n  "version": 1,\n  "zone": "city",\n  "note": "The world is generated from OpenStreetMap as an exact copy of real Manhattan: ${METERS_PER_BLOCK} m per block, rotated ${GRID_BEARING}° (avenues north-south). These points encode that transform exactly; the Minecraft-world mapping is kept in .cache/nju-jork-minecraft/georef.json.",\n  "points": [\n${frame.join(',\n')}\n  ]\n}\n`)

console.log(`tiles: ${tiles.length}; roads: ${roads.length}; nodes: ${usedNodes.length}; building markers: ${markers.length} (${keptIds} kept old landmark IDs); start ${start.join(', ')}`)
