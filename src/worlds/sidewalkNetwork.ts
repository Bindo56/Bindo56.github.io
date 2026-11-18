export type Point = { x: number; z: number }
export type SidewalkData = {
  version: number
  nodes: [number, number][]
  edges: [number, number][]
  walkways: [number, number][]
  junctions: Record<string, number>
  access: Record<string, number>
  entrances: Record<string, number>
  connectors: [number, number, number, number][]
  crossings: [number, number, number, number][]
}
export type WalkingRoute = { points: Point[]; distances: number[]; length: number }

type Neighbor = { id: number; length: number }
type QueueItem = { id: number; score: number }

class MinQueue {
  private values: QueueItem[] = []
  get size() { return this.values.length }
  push(item: QueueItem) {
    const values = this.values
    let index = values.length
    values.push(item)
    while (index > 0) {
      const parent = (index - 1) >>> 1
      if (values[parent].score <= item.score) break
      values[index] = values[parent]
      index = parent
    }
    values[index] = item
  }
  pop(): QueueItem | undefined {
    const values = this.values
    if (!values.length) return undefined
    const first = values[0]
    const last = values.pop()!
    if (!values.length) return first
    let index = 0
    while (true) {
      const left = index * 2 + 1
      if (left >= values.length) break
      const right = left + 1
      const child = right < values.length && values[right].score < values[left].score ? right : left
      if (values[child].score >= last.score) break
      values[index] = values[child]
      index = child
    }
    values[index] = last
    return first
  }
}

/** Approximate pedestrian graph built from both sides of mapped streets and building entrances. */
export class SidewalkNetwork {
  private readonly neighbors: Neighbor[][]
  private readonly walkwayNeighbors: number[][]
  private readonly cache = new Map<string, WalkingRoute | null>()
  private readonly walkCells = new Map<string, number[]>()
  private readonly walkCellSize = 24
  constructor(readonly data: SidewalkData) {
    this.neighbors = Array.from({ length: data.nodes.length }, () => [])
    this.walkwayNeighbors = Array.from({ length: data.nodes.length }, () => [])
    for (const [a, b] of data.edges) {
      const length = this.distance(a, b)
      this.neighbors[a].push({ id: b, length })
      this.neighbors[b].push({ id: a, length })
    }
    for (let index = 0; index < data.walkways.length; index++) {
      const [a, b] = data.walkways[index]
      this.walkwayNeighbors[a].push(b)
      this.walkwayNeighbors[b].push(a)
      const [ax, az] = data.nodes[a], [bx, bz] = data.nodes[b]
      for (let x = Math.floor(Math.min(ax, bx) / this.walkCellSize); x <= Math.floor(Math.max(ax, bx) / this.walkCellSize); x++) {
        for (let z = Math.floor(Math.min(az, bz) / this.walkCellSize); z <= Math.floor(Math.max(az, bz) / this.walkCellSize); z++) {
          const key = `${x},${z}`
          const cell = this.walkCells.get(key) ?? []
          cell.push(index)
          this.walkCells.set(key, cell)
        }
      }
    }
  }

  /** A short deterministic walk along mapped pavement near a public destination. */
  wanderRoute(x: number, z: number, seed: number, radius = 70): WalkingRoute | null {
    const cellX = Math.floor(x / this.walkCellSize), cellZ = Math.floor(z / this.walkCellSize)
    const reach = Math.ceil(radius / this.walkCellSize)
    const candidates = new Set<number>()
    for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) {
      for (const index of this.walkCells.get(`${cellX + dx},${cellZ + dz}`) ?? []) {
        const [a, b] = this.data.walkways[index]
        const [ax, az] = this.data.nodes[a], [bx, bz] = this.data.nodes[b]
        if ((ax + bx - 2 * x) ** 2 + (az + bz - 2 * z) ** 2 <= 4 * radius * radius
          && this.distance(a, b) > .5) candidates.add(index)
      }
    }
    if (!candidates.size) return null
    const choices = [...candidates]
    const [a, b] = this.data.walkways[choices[(Math.imul(seed, 0x9e3779b1) >>> 0) % choices.length]]
    let previous = a, current = b
    const path = [a, b]
    let length = this.distance(a, b)
    for (let step = 0; step < 16 && length < 35; step++) {
      const options = this.walkwayNeighbors[current].filter((id) => id !== previous)
      if (!options.length) break
      const next = options[(Math.imul(seed + step, 0x85ebca6b) >>> 0) % options.length]
      length += this.distance(current, next)
      path.push(next)
      previous = current
      current = next
    }
    const points = path.map((id) => ({ x: this.data.nodes[id][0], z: this.data.nodes[id][1] }))
    const distances = [0]
    for (let index = 1; index < path.length; index++)
      distances.push(distances[index - 1] + this.distance(path[index - 1], path[index]))
    return { points, distances, length: distances.at(-1)! }
  }

  /** Project a legacy street-cart point onto the nearest visible walkway. */
  snap(x: number, z: number): Point {
    const cx = Math.floor(x / this.walkCellSize), cz = Math.floor(z / this.walkCellSize)
    const candidates = new Set<number>()
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      for (const index of this.walkCells.get(`${cx + dx},${cz + dz}`) ?? []) candidates.add(index)
    }
    if (!candidates.size) for (let index = 0; index < this.data.walkways.length; index++) candidates.add(index)
    let best: Point = { x, z }, bestDistance = Infinity
    for (const index of candidates) {
      const [a, b] = this.data.walkways[index]
      const [ax, az] = this.data.nodes[a], [bx, bz] = this.data.nodes[b]
      const dx = bx - ax, dz = bz - az, lengthSq = dx * dx + dz * dz
      const t = lengthSq ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0
      const px = ax + dx * t, pz = az + dz * t
      const distance = (x - px) ** 2 + (z - pz) ** 2
      if (distance < bestDistance) { best = { x: px, z: pz }; bestDistance = distance }
    }
    return best
  }

  private distance(a: number, b: number) {
    const [ax, az] = this.data.nodes[a], [bx, bz] = this.data.nodes[b]
    return Math.hypot(ax - bx, az - bz)
  }

  private node(anchorId: string) {
    return this.data.entrances[anchorId] ?? this.data.access[anchorId] ?? this.data.junctions[anchorId]
  }

  entrance(anchorId: string): Point | null {
    const id = this.node(anchorId)
    if (id === undefined) return null
    const [x, z] = this.data.nodes[id]
    return { x, z }
  }

  route(fromAnchor: string, toAnchor: string): WalkingRoute | null {
    const start = this.node(fromAnchor), goal = this.node(toAnchor)
    if (start === undefined || goal === undefined) return null
    const key = `${fromAnchor}>${toAnchor}`
    if (this.cache.has(key)) return this.cache.get(key)!
    const count = this.data.nodes.length
    const cost = new Float64Array(count).fill(Infinity)
    const previous = new Int32Array(count).fill(-1)
    const queue = new MinQueue()
    cost[start] = 0
    queue.push({ id: start, score: this.distance(start, goal) })
    while (queue.size) {
      const current = queue.pop()!
      if (current.score > cost[current.id] + this.distance(current.id, goal) + .00001) continue
      if (current.id === goal) break
      for (const next of this.neighbors[current.id]) {
        const candidate = cost[current.id] + next.length
        if (candidate >= cost[next.id]) continue
        cost[next.id] = candidate
        previous[next.id] = current.id
        queue.push({ id: next.id, score: candidate + this.distance(next.id, goal) })
      }
    }
    if (!Number.isFinite(cost[goal])) { this.cache.set(key, null); return null }
    const path = []
    for (let node = goal; node !== -1; node = previous[node]) path.push(node)
    path.reverse()
    const points = path.map((id) => ({ x: this.data.nodes[id][0], z: this.data.nodes[id][1] }))
    const distances = [0]
    for (let i = 1; i < path.length; i++) distances.push(distances[i - 1] + this.distance(path[i - 1], path[i]))
    const route = { points, distances, length: distances.at(-1)! }
    if (this.cache.size >= 2048) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(key, route)
    return route
  }

  sample(route: WalkingRoute, progress: number): Point {
    if (route.points.length === 1 || !route.length) return route.points[0]
    const target = Math.max(0, Math.min(1, progress)) * route.length
    let low = 0, high = route.distances.length - 1
    while (low < high) {
      const middle = (low + high) >>> 1
      if (route.distances[middle] < target) low = middle + 1
      else high = middle
    }
    const index = Math.max(1, low)
    const previous = route.distances[index - 1], next = route.distances[index]
    const blend = next > previous ? (target - previous) / (next - previous) : 0
    const a = route.points[index - 1], b = route.points[index]
    return { x: a.x + (b.x - a.x) * blend, z: a.z + (b.z - a.z) * blend }
  }
}
