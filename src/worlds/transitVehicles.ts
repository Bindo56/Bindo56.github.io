import * as THREE from 'three'
import { buildVoxelTrain } from './voxelTrains'
import type { SurfaceRail, TransitMode, TransitZone } from './transitNetwork'

type Path = { points: THREE.Vector3[]; distances: number[]; length: number }
type Vehicle = { model: THREE.Group; path: Path; offset: number; speed: number; mode: TransitMode; schematic: boolean }

function pathFromPoints(points: THREE.Vector3[]): Path | null {
  if (points.length < 2) return null
  const distances = [0]
  for (let index = 1; index < points.length; index++)
    distances.push(distances[index - 1] + points[index].distanceTo(points[index - 1]))
  const length = distances.at(-1)!
  return length > 1 ? { points, distances, length } : null
}

/** Follow one connected set of mapped track edges, rather than straight station-to-station lines. */
function routePath(zone: TransitZone, mode: TransitMode, route: string): Path | null {
  const nodes = new Map(zone.nodes.map((node) => [node.id, node]))
  const links = new Map<string, string[]>()
  for (const edge of zone.edges) {
    if (edge.kind !== 'track' || edge.mode !== mode || !edge.routes.includes(route)) continue
    for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const adjacent = links.get(a) ?? []
      adjacent.push(b)
      links.set(a, adjacent)
    }
  }
  const start = [...links.keys()].filter((id) => links.get(id)?.length === 1)
    .sort((a, b) => (nodes.get(b)?.z ?? 0) - (nodes.get(a)?.z ?? 0))[0]
  if (!start) return null
  const points: THREE.Vector3[] = []
  let previous = '', current = start
  const visited = new Set<string>()
  while (!visited.has(current)) {
    visited.add(current)
    const node = nodes.get(current)
    if (!node) break
    points.push(new THREE.Vector3(node.x, 0, node.z))
    const next = links.get(current)?.find((id) => id !== previous && !visited.has(id))
    if (!next) break
    previous = current
    current = next
  }
  return pathFromPoints(points)
}

function closestDistance(path: Path, x: number, z: number): number {
  let nearest = 0, best = Infinity
  path.points.forEach((point, index) => {
    const distance = (point.x - x) ** 2 + (point.z - z) ** 2
    if (distance < best) { best = distance; nearest = path.distances[index] }
  })
  return nearest
}

function sample(path: Path, distance: number, target: THREE.Vector3): number {
  let low = 1, high = path.distances.length - 1
  while (low < high) {
    const middle = (low + high) >>> 1
    if (path.distances[middle] < distance) low = middle + 1
    else high = middle
  }
  const before = path.distances[low - 1], after = path.distances[low]
  const fraction = after > before ? (distance - before) / (after - before) : 0
  const a = path.points[low - 1], b = path.points[low]
  target.copy(a).lerp(b, fraction)
  return Math.atan2(b.x - a.x, b.z - a.z)
}

/** Reuses the train-workbench models on mapped transit paths. Underground service is a map projection. */
export class TransitVehicles {
  private readonly group = new THREE.Group()
  private readonly vehicles: Vehicle[] = []
  private elapsed = 0

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'Moving subway and Metro-North trains'
    scene.add(this.group)
  }

  configure(zone: TransitZone, surfaceRail: SurfaceRail[]): void {
    this.disposeModels()
    const subwayProjection = buildVoxelTrain('subway')
    const metroProjection = buildVoxelTrain('metro-north')
    const subwayBridge = buildVoxelTrain('subway')
    for (const prototype of [subwayProjection, metroProjection]) prototype.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const material = (object.material as THREE.MeshBasicMaterial).clone()
      material.transparent = true
      material.opacity = .88
      material.depthTest = false
      material.depthWrite = false
      object.material = material
      object.renderOrder = 20
    })
    const add = (prototype: THREE.Group, path: Path | null, mode: TransitMode,
      x: number, z: number, offsets: number[], speed: number, schematic: boolean) => {
      if (!path) return
      const near = closestDistance(path, x, z)
      for (const extra of offsets) {
        const model = prototype.clone(true)
        model.scale.setScalar(.4)
        model.visible = false
        this.group.add(model)
        this.vehicles.push({ model, path, offset: near + extra, speed, mode, schematic })
      }
    }
    add(subwayProjection, routePath(zone, 'subway', '1'), 'subway', -537, 35, [0, -240, 240], 10, true)
    add(subwayProjection, routePath(zone, 'subway', '7'), 'subway', -518, 20, [0, 140], 10, true)
    add(subwayProjection, routePath(zone, 'subway', '4'), 'subway', -239, -31, [0], 10, true)
    add(metroProjection, routePath(zone, 'metro-north', '1'), 'metro-north', -239, -31, [0, 210], 12, true)
    for (const name of ['Manhattan Bridge', 'Williamsburg Bridge']) {
      const ways = surfaceRail.filter((way) => way.name === name)
      const way = ways.sort((a, b) => b.points.length - a.points.length)[0]
      if (!way) continue
      const path = pathFromPoints(way.points.map(([x, z]) => new THREE.Vector3(x, way.deckY + .75, z)))
      add(subwayBridge, path, 'subway', way.points[0][0], way.points[0][1], [50], 11, false)
    }
  }

  update(dt: number, city: boolean, subway: boolean, metro: boolean,
    viewHeight: number, focus: THREE.Vector3): boolean {
    this.elapsed += Math.max(0, Math.min(dt, .1))
    let moving = false
    for (const vehicle of this.vehicles) {
      const enabled = city && (vehicle.mode === 'subway' ? subway : metro)
        && (vehicle.schematic ? viewHeight >= 75 && viewHeight < 800 : viewHeight < 1200)
      if (!enabled) { vehicle.model.visible = false; continue }
      const loop = vehicle.path.length * 2
      const phase = ((vehicle.offset + this.elapsed * vehicle.speed) % loop + loop) % loop
      const reverse = phase > vehicle.path.length
      const distance = reverse ? loop - phase : phase
      const angle = sample(vehicle.path, distance, vehicle.model.position)
      if (vehicle.schematic) vehicle.model.position.y = .55
      vehicle.model.rotation.y = angle + (reverse ? Math.PI : 0)
      const nearby = Math.hypot(vehicle.model.position.x - focus.x, vehicle.model.position.z - focus.z)
        < Math.max(140, viewHeight * 1.6)
      vehicle.model.visible = nearby
      moving ||= nearby
    }
    return moving
  }

  private disposeModels(): void {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    for (const vehicle of this.vehicles) vehicle.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      geometries.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
    })
    for (const vehicle of this.vehicles) vehicle.model.removeFromParent()
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
    this.vehicles.length = 0
  }

  dispose(): void {
    this.disposeModels()
    this.scene.remove(this.group)
  }
}
