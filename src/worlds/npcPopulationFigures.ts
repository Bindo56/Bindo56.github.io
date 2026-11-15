import * as THREE from 'three'
import { loadProofCharacter, type ProofCharacter } from './npcProofCharacter'
import type { NearbyNpc } from './npcPopulationProtocol'
import { STATION_COLLIDERS } from './stationLandmarks'
import { NpcRoadRouter, sampleRoute, type Road, type RoadNode, type RoadPoint, type Route } from './npcRoadRouting'
import type { NpcMovement } from './npcMovement'

type Travel = { route: Route; movement: NpcMovement }

function actionFor(activity: string): string {
  if (activity.includes('commute') || activity === 'errand' || activity === 'shopping') return 'walk'
  if (activity === 'work' || activity === 'school' || activity === 'study') return 'work'
  if (activity === 'social_meeting') return 'talk'
  return 'idle'
}

/** Displays nearby scheduled people using the same 100-variant FBX pack as Jose Campbell. */
export class NpcPopulationFigures {
  private readonly group = new THREE.Group()
  private readonly selectedRing = new THREE.Mesh(
    new THREE.RingGeometry(.32, .42, 32),
    new THREE.MeshBasicMaterial({ color: 0xf4c780, side: THREE.DoubleSide,
      depthTest: false, depthWrite: false }),
  )
  private readonly figures = new Map<number, ProofCharacter>()
  private readonly pending = new Set<number>()
  private readonly people = new Map<number, NearbyNpc>()
  private readonly positions = new Map<number, THREE.Vector3>()
  private readonly orbits = new Map<number, number>()
  private readonly travel = new Map<number, Travel>()
  private readonly roadCache = new Map<string, RoadPoint>()
  private roadNodes: RoadPoint[] = []
  private router: NpcRoadRouter | null = null
  private zoneId = 'city'
  private selectedId = 0
  private disposed = false

  constructor(private readonly scene: THREE.Scene, private readonly onChange: () => void) {
    this.group.name = 'Browser-hosted New York FBX NPCs'
    this.selectedRing.rotation.x = -Math.PI / 2
    this.selectedRing.renderOrder = 1000
    this.selectedRing.visible = false
    this.group.add(this.selectedRing)
    this.scene.add(this.group)
  }

  select(npcId: number): void {
    this.selectedId = npcId
    this.selectedRing.visible = npcId !== 0 && this.positions.has(npcId)
    if (this.selectedRing.visible) this.selectedRing.position.copy(this.positions.get(npcId)!).setY(.04)
    this.onChange()
  }

  setRoadNodes(nodes: RoadNode[], roads: Road[]): void {
    this.roadNodes = nodes
    this.router = new NpcRoadRouter(nodes, roads, (point) => this.clearOfStations(point))
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

  private roadPosition(point: RoadPoint, placeId: string): RoadPoint {
    const cached = this.roadCache.get(placeId)
    if (cached) return cached
    let best: RoadPoint = point
    let distance = Infinity
    for (const node of this.roadNodes) {
      if (!this.clearOfStations(node)) continue
      const next = (node.x - point.x) ** 2 + (node.z - point.z) ** 2
      if (next < distance) { best = node; distance = next }
    }
    this.roadCache.set(placeId, best)
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
      this.travel.delete(id)
    }
    const anchors = people.map((person) => {
      const place = person.movement?.to ?? person
      const point = this.roadPosition(place, person.movement?.to.id ?? person.placeId)
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
      let position = new THREE.Vector3(
        point.x + Math.sin(orbit) * along + Math.cos(orbit) * side,
        .02,
        point.z + Math.cos(orbit) * along - Math.sin(orbit) * side)
      const movement = person.movement
      const route = movement ? this.router?.route(movement.from, movement.to) : null
      if (movement && route && route.totalLength > 0) {
        this.travel.set(person.npcId, { route, movement })
        position = this.travelPosition(person.npcId, route, movement, movement.observedAtMs)
      } else this.travel.delete(person.npcId)
      this.positions.set(person.npcId, position)
      if (person.npcId === this.selectedId) {
        this.selectedRing.visible = true
        this.selectedRing.position.copy(position).setY(.04)
      }
      if (!this.travel.has(person.npcId)) this.orbits.set(person.npcId, orbit)
      const figure = this.figures.get(person.npcId)
      if (figure) {
        figure.group.position.copy(position)
        figure.setAction(this.actionForPerson(person.npcId, person.activity))
      } else if (!this.pending.has(person.npcId)) {
        this.pending.add(person.npcId)
        // Jose Campbell is variant zero in the proof. All other people use their stable appearance seed.
        const variant = person.npcId === 37669 ? 0 : person.appearanceSeed
        void loadProofCharacter(variant).then((character) => {
          if (this.disposed || !this.people.has(person.npcId)) { character.dispose(); return }
          character.group.name = `city-npc-${person.npcId}`
          character.group.userData.npcId = person.npcId
          character.group.position.copy(this.positions.get(person.npcId)!)
          character.setAction(this.actionForPerson(person.npcId, this.people.get(person.npcId)!.activity))
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

  private actionForPerson(npcId: number, activity: string): string {
    const travel = this.travel.get(npcId)
    if (!travel) return actionFor(activity)
    const seconds = (travel.movement.endMinute - travel.movement.startMinute) * 60
    return seconds > 0 && travel.route.totalLength / seconds > 1.1 ? 'run' : 'walk'
  }

  private travelPosition(npcId: number, route: Route, movement: NpcMovement, worldTimeMs: number): THREE.Vector3 {
    const durationMs = (movement.endMinute - movement.startMinute) * 60000
    const progress = Math.max(0, Math.min(1,
      movement.progress + (worldTimeMs - movement.observedAtMs) / durationMs))
    const point = sampleRoute(route, progress)
    this.orbits.set(npcId, point.heading)
    const side = ((npcId % 5) - 2) * .22
    return new THREE.Vector3(point.x + Math.cos(point.heading) * side, .02,
      point.z - Math.sin(point.heading) * side)
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

  update(dt: number, viewHeight: number, focus: THREE.Vector3, worldTimeMs: number): boolean {
    const enabled = this.zoneId === 'city' && viewHeight < 200
    if (this.group.visible !== enabled) {
      this.group.visible = enabled
      this.onChange()
    }
    if (!enabled) return false
    let changed = false
    const radius = Math.max(65, viewHeight * 1.5)
    for (const [id, figure] of this.figures) {
      const travel = this.travel.get(id)
      if (travel) {
        const position = this.travelPosition(id, travel.route, travel.movement, worldTimeMs)
        figure.group.position.copy(position)
        figure.group.rotation.y = this.orbits.get(id) ?? 0
        this.positions.set(id, position)
        if (id === this.selectedId) this.selectedRing.position.copy(position).setY(.04)
      }
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
    this.selectedRing.geometry.dispose()
    ;(this.selectedRing.material as THREE.Material).dispose()
  }
}
