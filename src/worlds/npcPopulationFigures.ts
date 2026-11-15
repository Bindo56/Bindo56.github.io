import * as THREE from 'three'
import { loadProofCharacter, type ProofCharacter } from './npcProofCharacter'
import type { NearbyNpc } from './npcPopulationProtocol'
import { STATION_COLLIDERS } from './stationLandmarks'

type RoadPoint = { x: number; z: number }

function actionFor(activity: string): string {
  if (activity.includes('commute') || activity === 'errand' || activity === 'shopping') return 'walk'
  if (activity === 'work' || activity === 'school' || activity === 'study') return 'work'
  if (activity === 'social_meeting') return 'talk'
  return 'idle'
}

/** Displays nearby scheduled people using the same 100-variant FBX pack as Jose Campbell. */
export class NpcPopulationFigures {
  private readonly group = new THREE.Group()
  private readonly figures = new Map<number, ProofCharacter>()
  private readonly pending = new Set<number>()
  private readonly people = new Map<number, NearbyNpc>()
  private readonly positions = new Map<number, THREE.Vector3>()
  private readonly orbits = new Map<number, number>()
  private readonly roadCache = new Map<string, RoadPoint>()
  private roadNodes: RoadPoint[] = []
  private zoneId = 'city'
  private disposed = false

  constructor(private readonly scene: THREE.Scene, private readonly onChange: () => void) {
    this.group.name = 'Browser-hosted New York FBX NPCs'
    this.scene.add(this.group)
  }

  setRoadNodes(nodes: RoadPoint[]): void {
    this.roadNodes = nodes
    this.roadCache.clear()
    if (this.people.size) this.setPeople([...this.people.values()])
  }

  setZone(id: string): void {
    this.zoneId = id
    this.group.visible = id === 'city'
    this.onChange()
  }

  private clearOfStations(point: RoadPoint): boolean {
    return STATION_COLLIDERS.every((box) => point.x < box.minX - 1.5 || point.x > box.maxX + 1.5
      || point.z < box.minZ - 1.5 || point.z > box.maxZ + 1.5)
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
    if (this.disposed) return
    this.people.clear()
    for (const person of people) this.people.set(person.npcId, person)
    for (const [id, figure] of this.figures) {
      if (this.people.has(id)) continue
      figure.dispose()
      this.figures.delete(id)
    }
    for (const id of this.positions.keys()) if (!this.people.has(id)) {
      this.positions.delete(id)
      this.orbits.delete(id)
    }
    const anchors = people.map((person) => {
      const point = this.roadPosition(person)
      return { person, point, orbit: this.roadOrbit(point), key: `${point.x},${point.z}` }
    })
    const totals = new Map<string, number>()
    const used = new Map<string, number>()
    for (const { key } of anchors) totals.set(key, (totals.get(key) ?? 0) + 1)
    for (const { person, point, orbit, key } of anchors) {
      const rank = used.get(key) ?? 0
      used.set(key, rank + 1)
      const count = totals.get(key)!
      const side = count > 1 ? (rank % 2 ? .8 : -.8) : 0
      const along = (Math.floor(rank / 2) - (Math.ceil(count / 2) - 1) / 2) * 1.5
      const position = new THREE.Vector3(
        point.x + Math.sin(orbit) * along + Math.cos(orbit) * side,
        .02,
        point.z + Math.cos(orbit) * along - Math.sin(orbit) * side)
      this.positions.set(person.npcId, position)
      this.orbits.set(person.npcId, orbit)
      const figure = this.figures.get(person.npcId)
      if (figure) {
        figure.group.position.copy(position)
        figure.setAction(actionFor(person.activity))
      } else if (!this.pending.has(person.npcId)) {
        this.pending.add(person.npcId)
        // Jose Campbell is variant zero in the proof. All other people use their stable appearance seed.
        const variant = person.npcId === 37669 ? 0 : person.appearanceSeed
        void loadProofCharacter(variant).then((character) => {
          if (this.disposed || !this.people.has(person.npcId)) { character.dispose(); return }
          character.group.name = `city-npc-${person.npcId}`
          character.group.userData.npcId = person.npcId
          character.group.position.copy(this.positions.get(person.npcId)!)
          character.setAction(actionFor(this.people.get(person.npcId)!.activity))
          this.group.add(character.group)
          this.figures.set(person.npcId, character)
          this.onChange()
        }).catch((error) => {
          console.error('Could not load 100 People NPC model:', error)
        }).finally(() => { this.pending.delete(person.npcId) })
      }
    }
    this.onChange()
  }

  positionFor(npcId: number): THREE.Vector3 | null {
    return this.positions.get(npcId)?.clone() ?? null
  }

  orbitFor(npcId: number): number | null {
    return this.orbits.get(npcId) ?? null
  }

  pick(camera: THREE.Camera, x: number, y: number): number | null {
    if (!this.group.visible) return null
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(x, y), camera)
    for (const hit of ray.intersectObject(this.group, true)) {
      let object: THREE.Object3D | null = hit.object
      while (object && object !== this.group) {
        const id = object.userData.npcId
        if (typeof id === 'number' && object.visible) return id
        object = object.parent
      }
    }
    return null
  }

  update(dt: number, viewHeight: number, focus: THREE.Vector3): boolean {
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
      if (visible) {
        figure.update(dt)
        changed = true
      }
    }
    return changed
  }

  dispose(): void {
    this.disposed = true
    for (const figure of this.figures.values()) figure.dispose()
    this.figures.clear()
    this.scene.remove(this.group)
  }
}
