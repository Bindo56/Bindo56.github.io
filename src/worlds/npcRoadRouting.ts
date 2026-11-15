export type RoadPoint = { x: number; z: number }
export type RoadNode = RoadPoint & { id: string }
export type Road = { from: string; to: string; points: [number, number][]; length: number }
export type Route = { points: RoadPoint[]; lengths: number[]; totalLength: number }

type Arc = { to: string; points: RoadPoint[]; length: number }
type QueueItem = { id: string; score: number }

class MinQueue {
  private values: QueueItem[] = []
  get size(): number { return this.values.length }
  push(item: QueueItem): void {
    let index = this.values.length
    this.values.push(item)
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.values[parent].score <= item.score) break
      this.values[index] = this.values[parent]
      index = parent
    }
    this.values[index] = item
  }
  pop(): QueueItem | undefined {
    const first = this.values[0]
    const tail = this.values.pop()
    if (!first || !tail || !this.values.length) return first
    let index = 0
    while (index * 2 + 1 < this.values.length) {
      let child = index * 2 + 1
      if (child + 1 < this.values.length && this.values[child + 1].score < this.values[child].score) child++
      if (tail.score <= this.values[child].score) break
      this.values[index] = this.values[child]
      index = child
    }
    this.values[index] = tail
    return first
  }
}

function distance(a: RoadPoint, b: RoadPoint): number { return Math.hypot(a.x - b.x, a.z - b.z) }

function makeRoute(points: RoadPoint[]): Route {
  const lengths = points.slice(1).map((point, index) => distance(points[index], point))
  return { points, lengths, totalLength: lengths.reduce((sum, length) => sum + length, 0) }
}

export function sampleRoute(route: Route, progress: number): RoadPoint & { heading: number } {
  if (!route.points.length) return { x: 0, z: 0, heading: 0 }
  if (route.points.length === 1) return { ...route.points[0], heading: 0 }
  let remaining = Math.max(0, Math.min(1, progress)) * route.totalLength
  for (let index = 0; index < route.lengths.length; index++) {
    const length = route.lengths[index]
    if (remaining > length && index < route.lengths.length - 1) { remaining -= length; continue }
    const from = route.points[index], to = route.points[index + 1]
    const fraction = length ? Math.min(1, remaining / length) : 0
    return { x: from.x + (to.x - from.x) * fraction,
      z: from.z + (to.z - from.z) * fraction,
      heading: Math.atan2(to.x - from.x, to.z - from.z) }
  }
  return { ...route.points.at(-1)!, heading: 0 }
}

/** A* on the mapped road polylines. Routes are cached for nearby visible NPCs. */
export class NpcRoadRouter {
  private readonly nodes = new Map<string, RoadNode>()
  private readonly arcs = new Map<string, Arc[]>()
  private readonly cache = new Map<string, Route | null>()

  constructor(nodes: RoadNode[], roads: Road[], isAllowed: (point: RoadPoint) => boolean = () => true) {
    for (const node of nodes) if (isAllowed(node)) {
      this.nodes.set(node.id, node)
      this.arcs.set(node.id, [])
    }
    for (const road of roads) {
      if (!this.nodes.has(road.from) || !this.nodes.has(road.to)) continue
      const points = road.points.map(([x, z]) => ({ x, z }))
      if (points.length < 2 || points.some((point) => !isAllowed(point))) continue
      const length = points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0)
      if (length <= 0) continue
      this.arcs.get(road.from)!.push({ to: road.to, points, length })
      this.arcs.get(road.to)!.push({ to: road.from, points: [...points].reverse(), length })
    }
  }

  nearest(point: RoadPoint): RoadNode | null {
    let best: RoadNode | null = null
    let smallest = Infinity
    for (const node of this.nodes.values()) {
      const next = (node.x - point.x) ** 2 + (node.z - point.z) ** 2
      if (next < smallest) { best = node; smallest = next }
    }
    return best
  }

  route(from: RoadPoint, to: RoadPoint): Route | null {
    const start = this.nearest(from), goal = this.nearest(to)
    if (!start || !goal) return null
    const key = `${start.id}>${goal.id}`
    if (this.cache.has(key)) return this.cache.get(key)!
    if (start.id === goal.id) return makeRoute([start])
    const queue = new MinQueue()
    const cost = new Map<string, number>([[start.id, 0]])
    const previous = new Map<string, { id: string; arc: Arc }>()
    queue.push({ id: start.id, score: distance(start, goal) })
    while (queue.size) {
      const item = queue.pop()!
      if (item.score > (cost.get(item.id) ?? Infinity) + distance(this.nodes.get(item.id)!, goal) + 1e-6) continue
      if (item.id === goal.id) break
      for (const arc of this.arcs.get(item.id) ?? []) {
        const next = cost.get(item.id)! + arc.length
        if (next >= (cost.get(arc.to) ?? Infinity)) continue
        cost.set(arc.to, next)
        previous.set(arc.to, { id: item.id, arc })
        queue.push({ id: arc.to, score: next + distance(this.nodes.get(arc.to)!, goal) })
      }
    }
    let result: Route | null = null
    if (previous.has(goal.id)) {
      const segments: RoadPoint[][] = []
      let cursor = goal.id
      while (cursor !== start.id) {
        const step = previous.get(cursor)!
        segments.push(step.arc.points)
        cursor = step.id
      }
      const points: RoadPoint[] = []
      for (const segment of segments.reverse()) points.push(...(points.length ? segment.slice(1) : segment))
      result = makeRoute(points)
    }
    this.cache.set(key, result)
    if (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!)
    return result
  }
}
