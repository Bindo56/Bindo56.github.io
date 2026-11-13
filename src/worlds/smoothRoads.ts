import * as THREE from 'three'

export type SurfaceRoad = {
  points: [number, number][]
  width: number
  sidewalk?: boolean
  bridge?: boolean
}

type Bounds = { left: number; top: number; right: number; bottom: number }
type SurfaceGeometry = { positions: number[]; indices: number[] }

// The road planes sit only a few centimetres above the voxel ground. Offset their
// depth and draw them after the tile so the two surfaces do not shimmer at distance.
const roadMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000, side: THREE.DoubleSide, fog: true,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
})
const footpathMaterial = new THREE.MeshBasicMaterial({
  color: 0x969696, side: THREE.DoubleSide, fog: true,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
})
const ROUND_STEPS = 12

function quad(out: SurfaceGeometry, ax: number, az: number, bx: number, bz: number, radius: number, y: number) {
  const length = Math.hypot(bx - ax, bz - az)
  if (length < .001) return
  const nx = (bz - az) * radius / length
  const nz = -(bx - ax) * radius / length
  const base = out.positions.length / 3
  out.positions.push(ax + nx, y, az + nz, ax - nx, y, az - nz,
    bx - nx, y, bz - nz, bx + nx, y, bz + nz)
  out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

function roundJoin(out: SurfaceGeometry, x: number, z: number, radius: number, y: number) {
  const base = out.positions.length / 3
  out.positions.push(x, y, z)
  for (let i = 0; i <= ROUND_STEPS; i++) {
    const angle = i * Math.PI * 2 / ROUND_STEPS
    out.positions.push(x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius)
    if (i) out.indices.push(base, base + i, base + i + 1)
  }
}

function overlaps(ax: number, az: number, bx: number, bz: number, radius: number, bounds: Bounds) {
  return Math.max(ax, bx) + radius >= bounds.left && Math.min(ax, bx) - radius <= bounds.right
    && Math.max(az, bz) + radius >= bounds.top && Math.min(az, bz) - radius <= bounds.bottom
}

function mesh(out: SurfaceGeometry, material: THREE.Material, name: string) {
  if (!out.indices.length) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.positions, 3))
  geometry.setIndex(out.indices)
  geometry.computeVertexNormals()
  const result = new THREE.Mesh(geometry, material)
  result.name = name
  return result
}

/** Smooth carriageways and grey footpaths over the block raster at loaded zoom levels. */
export function buildSmoothRoads(roads: SurfaceRoad[], bounds: Bounds, footpathWidth: number): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Smooth road surfaces'
  const black: SurfaceGeometry = { positions: [], indices: [] }
  const grey: SurfaceGeometry = { positions: [], indices: [] }
  for (const road of roads) {
    if (road.bridge || !road.width || road.points.length < 2) continue
    const roadRadius = road.width / 2
    const walkRadius = roadRadius + footpathWidth
    for (let i = 1; i < road.points.length; i++) {
      const [ax, az] = road.points[i - 1]
      const [bx, bz] = road.points[i]
      if (!overlaps(ax, az, bx, bz, walkRadius, bounds)) continue
      if (road.sidewalk) {
        quad(grey, ax, az, bx, bz, walkRadius, .045)
        roundJoin(grey, ax, az, walkRadius, .045)
        roundJoin(grey, bx, bz, walkRadius, .045)
      }
      quad(black, ax, az, bx, bz, roadRadius, .065)
      roundJoin(black, ax, az, roadRadius, .065)
      roundJoin(black, bx, bz, roadRadius, .065)
    }
  }
  const footpaths = mesh(grey, footpathMaterial, 'Smooth grey footpaths')
  const carriageways = mesh(black, roadMaterial, 'Smooth black carriageways')
  if (footpaths) footpaths.renderOrder = 1
  if (carriageways) carriageways.renderOrder = 2
  if (footpaths) group.add(footpaths)
  if (carriageways) group.add(carriageways)
  return group
}

export function disposeSmoothRoads(group: THREE.Group) {
  group.traverse((item) => { if (item instanceof THREE.Mesh) item.geometry.dispose() })
}
