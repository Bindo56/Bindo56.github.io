import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const asset = resolve(root, 'public/assets/nju-jork')
const roadNetwork = JSON.parse(readFileSync(resolve(asset, 'road-network.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(resolve(asset, 'manifest.json'), 'utf8'))
const zone = roadNetwork.zones.city
const walkWidth = manifest.footpathWidthBlocks ?? 2
const cellSize = 64
const nodes = []
const edges = []
const segments = []
const grid = new Map()
const junctions = {}
const access = {}
const entrances = {}
const connectors = []
const crossings = []

function addNode(x, z) {
  nodes.push([Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000])
  return nodes.length - 1
}
function addEdge(a, b) { if (a !== b) edges.push([a, b]) }
function indexSegment(a, b) {
  const [ax, az] = nodes[a], [bx, bz] = nodes[b]
  const segment = { a, b, ax, az, bx, bz }
  const index = segments.push(segment) - 1
  for (let ix = Math.floor(Math.min(ax, bx) / cellSize); ix <= Math.floor(Math.max(ax, bx) / cellSize); ix++) {
    for (let iz = Math.floor(Math.min(az, bz) / cellSize); iz <= Math.floor(Math.max(az, bz) / cellSize); iz++) {
      const key = `${ix},${iz}`
      if (!grid.has(key)) grid.set(key, [])
      grid.get(key).push(index)
    }
  }
}
function tangent(points, index) {
  const before = points[Math.max(0, index - 1)]
  const after = points[Math.min(points.length - 1, index + 1)]
  const dx = after[0] - before[0], dz = after[1] - before[1]
  const length = Math.hypot(dx, dz) || 1
  return [dz / length, -dx / length]
}

for (const node of zone.nodes) junctions[node.id] = addNode(node.x, node.z)
for (const road of zone.roads) {
  if (road.bridge || !road.width || road.points.length < 2) continue
  const offset = road.width / 2 + walkWidth * .55
  const sideNodes = [[], []]
  for (let i = 0; i < road.points.length; i++) {
    const [x, z] = road.points[i]
    const [nx, nz] = tangent(road.points, i)
    sideNodes[0].push(addNode(x + nx * offset, z + nz * offset))
    sideNodes[1].push(addNode(x - nx * offset, z - nz * offset))
  }
  for (const side of sideNodes) {
    addEdge(junctions[road.from], side[0])
    addEdge(junctions[road.to], side.at(-1))
    const [fx, fz] = nodes[junctions[road.from]], [tx, tz] = nodes[junctions[road.to]]
    crossings.push([nodes[side[0]][0], nodes[side[0]][1], fx, fz])
    crossings.push([nodes[side.at(-1)][0], nodes[side.at(-1)][1], tx, tz])
    access[road.from] ??= side[0]
    access[road.to] ??= side.at(-1)
    for (let i = 1; i < side.length; i++) {
      addEdge(side[i - 1], side[i])
      indexSegment(side[i - 1], side[i])
    }
  }
}

function nearestSidewalk(x, z) {
  const ix = Math.floor(x / cellSize), iz = Math.floor(z / cellSize)
  const candidates = new Set()
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    for (const index of grid.get(`${ix + dx},${iz + dz}`) ?? []) candidates.add(index)
  }
  if (!candidates.size) for (let i = 0; i < segments.length; i++) candidates.add(i)
  let best = null
  for (const index of candidates) {
    const segment = segments[index]
    const dx = segment.bx - segment.ax, dz = segment.bz - segment.az
    const lengthSq = dx * dx + dz * dz
    const t = lengthSq ? Math.max(0, Math.min(1, ((x - segment.ax) * dx + (z - segment.az) * dz) / lengthSq)) : 0
    const px = segment.ax + t * dx, pz = segment.az + t * dz
    const distanceSq = (px - x) ** 2 + (pz - z) ** 2
    if (!best || distanceSq < best.distanceSq) best = { segment, px, pz, distanceSq }
  }
  if (!best) throw new Error('No sidewalk segments were generated')
  return best
}

function buildingEdge(building, x, z) {
  const [left, top, right, bottom] = building.bounds
  const dx = x - building.x, dz = z - building.z
  const tx = dx > 0 ? (right - building.x) / dx : dx < 0 ? (left - building.x) / dx : Infinity
  const tz = dz > 0 ? (bottom - building.z) / dz : dz < 0 ? (top - building.z) / dz : Infinity
  const t = Math.min(tx, tz)
  if (!Number.isFinite(t)) return [building.x, building.z]
  return [building.x + dx * t, building.z + dz * t]
}

for (const building of zone.buildings) {
  const near = nearestSidewalk(building.x, building.z)
  const [ex, ez] = buildingEdge(building, near.px, near.pz)
  const snap = addNode(near.px, near.pz)
  const entry = addNode(ex, ez)
  addEdge(snap, near.segment.a)
  addEdge(snap, near.segment.b)
  addEdge(entry, snap)
  entrances[building.id] = entry
  connectors.push([nodes[entry][0], nodes[entry][1], nodes[snap][0], nodes[snap][1]])
}

const result = {
  version: 1,
  source: 'Road polylines and 3D building footprints; generated approximate sidewalk/entrance geometry',
  coordinateSystem: roadNetwork.coordinateSystem,
  nodes, edges, walkways: segments.map(({ a, b }) => [a, b]),
  junctions, access, entrances, connectors, crossings,
}
const output = resolve(asset, 'sidewalk-network.json')
writeFileSync(output, JSON.stringify(result))
console.log(`Built ${nodes.length} sidewalk nodes, ${edges.length} links, and ${Object.keys(entrances).length} building entrances at ${output}`)
