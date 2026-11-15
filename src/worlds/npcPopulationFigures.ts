import * as THREE from 'three'
import type { NearbyNpc } from './npcPopulationProtocol'
import { STATION_COLLIDERS } from './stationLandmarks'

type RoadPoint = { x: number; z: number }
type Figure = { group: THREE.Group; material: THREE.MeshBasicMaterial; orbit: number }

/** One world block is about 3 m. A 0.6-block figure is about 1.8 m tall. */
export class NpcPopulationFigures {
  private readonly group = new THREE.Group()
  private readonly bodyGeometry = new THREE.CylinderGeometry(.105, .12, .34, 6)
  private readonly headGeometry = new THREE.SphereGeometry(.105, 8, 6)
  private readonly headMaterial = new THREE.MeshBasicMaterial({ color: '#f2c994' })
  private readonly figures = new Map<number, Figure>()
  private readonly roadCache = new Map<string, RoadPoint>()
  private roadNodes: RoadPoint[] = []
  private zoneId = 'city'

  constructor(private readonly scene: THREE.Scene, private readonly onChange: () => void) {
    this.group.name = 'Browser-hosted New York NPCs'
    this.scene.add(this.group)
  }

  setRoadNodes(nodes: RoadPoint[]): void {
    this.roadNodes = nodes
    this.roadCache.clear()
  }

  setZone(id: string): void {
    this.zoneId = id
    this.group.visible = id === 'city'
    this.onChange()
  }

  private roadPosition(person: NearbyNpc): RoadPoint {
    const cached = this.roadCache.get(person.placeId)
    if (cached) return cached
    let best: RoadPoint = person
    let distance = Infinity
    for (const node of this.roadNodes) {
      if (!this.clearOfStations(node)) continue
      const next = (node.x - person.x) ** 2 + (node.z - person.z) ** 2
      if (next < distance) { best = node; distance = next }
    }
    this.roadCache.set(person.placeId, best)
    return best
  }

  private clearOfStations(point: RoadPoint): boolean {
    return STATION_COLLIDERS.every((box) => point.x < box.minX - 1.5 || point.x > box.maxX + 1.5
      || point.z < box.minZ - 1.5 || point.z > box.maxZ + 1.5)
  }

  private roadOrbit(point: RoadPoint): number {
    let closest: RoadPoint | null = null
    let distance = Infinity
    for (const node of this.roadNodes) {
      if (!this.clearOfStations(node)) continue
      const next = (node.x - point.x) ** 2 + (node.z - point.z) ** 2
      if (next < 9 || next >= distance) continue
      closest = node
      distance = next
    }
    return closest ? Math.atan2(closest.x - point.x, closest.z - point.z) : 0
  }

  setPeople(people: NearbyNpc[]): void {
    const incoming = new Set(people.map((person) => person.npcId))
    for (const [id, figure] of this.figures) {
      if (incoming.has(id)) continue
      this.group.remove(figure.group)
      figure.material.dispose()
      this.figures.delete(id)
    }
    for (const person of people) {
      let figure = this.figures.get(person.npcId)
      if (!figure) {
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL((person.npcId * .618034) % 1, .6, .58),
        })
        const group = new THREE.Group()
        const body = new THREE.Mesh(this.bodyGeometry, material)
        body.position.y = .21
        const head = new THREE.Mesh(this.headGeometry, this.headMaterial)
        head.position.y = .48
        group.add(body, head)
        group.userData.npcId = person.npcId
        this.group.add(group)
        figure = { group, material, orbit: 0 }
        this.figures.set(person.npcId, figure)
      }
      const point = this.roadPosition(person)
      figure.orbit = this.roadOrbit(point)
      const angle = person.npcId * 2.39996
      figure.group.position.set(point.x + Math.cos(angle) * .35, .02, point.z + Math.sin(angle) * .35)
    }
    this.onChange()
  }

  positionFor(npcId: number): THREE.Vector3 | null {
    return this.figures.get(npcId)?.group.position.clone() ?? null
  }

  orbitFor(npcId: number): number | null {
    return this.figures.get(npcId)?.orbit ?? null
  }

  update(viewHeight: number, focus: THREE.Vector3): boolean {
    const enabled = this.zoneId === 'city' && viewHeight < 200
    if (this.group.visible !== enabled) {
      this.group.visible = enabled
      this.onChange()
    }
    if (!enabled) return false
    let changed = false
    const radius = Math.max(65, viewHeight * 1.5)
    for (const figure of this.figures.values()) {
      const position = figure.group.position
      const visible = Math.hypot(position.x - focus.x, position.z - focus.z) < radius
      if (figure.group.visible !== visible) {
        figure.group.visible = visible
        changed = true
      }
    }
    return changed
  }

  dispose(): void {
    for (const figure of this.figures.values()) figure.material.dispose()
    this.bodyGeometry.dispose()
    this.headGeometry.dispose()
    this.headMaterial.dispose()
    this.scene.remove(this.group)
  }
}
