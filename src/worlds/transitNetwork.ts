import * as THREE from 'three'

export type TransitMode = 'subway' | 'metro-north'
export type TransitNode = {
  id: string
  x: number
  z: number
  mode: TransitMode
  kind: 'station' | 'corner' | 'junction' | 'end' | 'portal'
  name?: string
  gtfsStopId?: string
  routes?: string[]
}
export type TransitEdge = {
  id: string
  from: string
  to: string
  kind: 'track' | 'station-access' | 'transfer'
  mode: TransitMode
  routes: string[]
  length: number
  minutes?: number
  source?: string
}
export type TransitRoute = { id: string; mode: TransitMode; name: string; description: string }
export type SurfaceRail = { id: string; mode: 'subway'; name: string; elevation: 'bridge'; deckY: number; points: [number, number][] }
export type TransitZone = {
  nodes: TransitNode[]
  edges: TransitEdge[]
  rideLinks: { mode: TransitMode; route: string; from: string; to: string; minutes: number }[]
  routes: TransitRoute[]
}
export type TransitNetwork = { version: number; source: string; zones: Record<string, TransitZone>; surfaceRail: SurfaceRail[] }

type ScreenPoint = { x: number; y: number; visible: boolean }
type ClipPoint = { x: number; y: number; z: number; w: number }
type ScreenSegment = [number, number, number, number]
const CLIP_PLANES: [number, number, number, number][] = [
  [1, 0, 0, 1], [-1, 0, 0, 1], [0, 1, 0, 1],
  [0, -1, 0, 1], [0, 0, 1, 1], [0, 0, -1, 1],
]

// Clip in homogeneous camera space, before dividing by w. This keeps a track
// visible when an endpoint is off screen or behind the street-level camera.
function clipTrack(a: ClipPoint, b: ClipPoint, width: number, height: number): ScreenSegment | null {
  let start = 0
  let end = 1
  for (const [px, py, pz, pw] of CLIP_PLANES) {
    const first = px * a.x + py * a.y + pz * a.z + pw * a.w
    const second = px * b.x + py * b.y + pz * b.z + pw * b.w
    if (first < 0 && second < 0) return null
    if (first >= 0 && second >= 0) continue
    const crossing = first / (first - second)
    if (first < 0) start = Math.max(start, crossing)
    else end = Math.min(end, crossing)
    if (start > end) return null
  }
  const project = (fraction: number): [number, number] => {
    const w = a.w + (b.w - a.w) * fraction
    const x = (a.x + (b.x - a.x) * fraction) / w
    const y = (a.y + (b.y - a.y) * fraction) / w
    return [(x + 1) * width / 2, (1 - y) * height / 2]
  }
  const [ax, ay] = project(start)
  const [bx, by] = project(end)
  return Number.isFinite(ax + ay + bx + by) ? [ax, ay, bx, by] : null
}

/** Schematic transit routing graphs plus real above-ground bridge rail; no vehicles or passengers. */
export class TransitOverlay {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly projected = new Map<string, ScreenPoint>()
  private readonly clipPoints = new Map<string, ClipPoint>()
  private readonly vector = new THREE.Vector4()
  private readonly viewProjection = new THREE.Matrix4()

  constructor(stage: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'nj-transit-network'
    this.canvas.setAttribute('aria-hidden', 'true')
    stage.append(this.canvas)
    this.context = this.canvas.getContext('2d')!
  }

  draw(zone: TransitZone | undefined, surfaceRail: SurfaceRail[], camera: THREE.Camera, showSubway: boolean,
    showMetro: boolean, viewHeight: number, focus: THREE.Vector3) {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (!width || !height) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const pixelWidth = Math.round(width * ratio)
    const pixelHeight = Math.round(height * ratio)
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth
      this.canvas.height = pixelHeight
    }
    const context = this.context
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    if (!zone || (!showSubway && !showMetro)) return

    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.projected.clear()
    this.clipPoints.clear()
    for (const node of zone.nodes) {
      if (node.mode === 'subway' ? !showSubway : !showMetro) continue
      this.vector.set(node.x, .7, node.z, 1).applyMatrix4(this.viewProjection)
      const point = { x: this.vector.x, y: this.vector.y, z: this.vector.z, w: this.vector.w }
      this.clipPoints.set(node.id, point)
      if (node.kind !== 'station' && node.kind !== 'corner' && node.kind !== 'junction' && node.kind !== 'portal' && node.kind !== 'end') continue
      if (point.w <= 0) continue
      const x = (point.x / point.w + 1) * width / 2
      const y = (1 - point.y / point.w) * height / 2
      this.projected.set(node.id, {
        x, y, visible: point.z >= -point.w && point.z <= point.w
          && x >= -60 && x <= width + 60 && y >= -60 && y <= height + 60,
      })
    }

    const schematicSegments: Record<TransitMode, ScreenSegment[]> = { subway: [], 'metro-north': [] }
    for (const edge of zone.edges) {
      if (edge.kind !== 'track') continue
      if (edge.mode === 'subway' ? !showSubway : !showMetro) continue
      const from = this.clipPoints.get(edge.from)
      const to = this.clipPoints.get(edge.to)
      if (!from || !to) continue
      const segment = clipTrack(from, to, width, height)
      if (segment) schematicSegments[edge.mode].push(segment)
    }
    const segments: ScreenSegment[] = []
    if (showSubway) for (const way of surfaceRail) {
      for (let i = 1; i < way.points.length; i++) {
        const [ax, az] = way.points[i - 1]
        const [bx, bz] = way.points[i]
        this.vector.set(ax, way.deckY + .8, az, 1).applyMatrix4(this.viewProjection)
        const from = { x: this.vector.x, y: this.vector.y, z: this.vector.z, w: this.vector.w }
        this.vector.set(bx, way.deckY + .8, bz, 1).applyMatrix4(this.viewProjection)
        const to = { x: this.vector.x, y: this.vector.y, z: this.vector.z, w: this.vector.w }
        const segment = clipTrack(from, to, width, height)
        if (segment) segments.push(segment)
      }
    }

    const lineWidth = viewHeight > 650 ? 1.6 : viewHeight > 150 ? 2.5 : 3.5
    // Dashed lines are routing overlays, not physical tracks at street height.
    for (const [mode, color] of [['subway', '#56d8cb'], ['metro-north', '#fb96cb']] as const) {
      if (mode === 'subway' ? !showSubway : !showMetro) continue
      context.beginPath()
      context.lineWidth = mode === 'metro-north' ? lineWidth + .4 : Math.max(1.5, lineWidth - .4)
      context.strokeStyle = color
      context.globalAlpha = mode === 'metro-north' ? .95 : .8
      context.lineCap = 'round'
      context.setLineDash(viewHeight > 500 ? [4, 4] : [6, 5])
      for (const [ax, ay, bx, by] of schematicSegments[mode]) {
        context.moveTo(ax, ay)
        context.lineTo(bx, by)
      }
      context.stroke()
      context.setLineDash([])
    }
    if (showSubway) {
      for (const halo of [true, false]) {
        context.beginPath()
        context.lineWidth = halo ? lineWidth + 3 : lineWidth
        context.strokeStyle = halo ? 'rgba(5, 21, 27, .8)' : '#49e4d0'
        context.globalAlpha = halo ? .85 : .95
        context.lineCap = 'round'
        for (const [ax, ay, bx, by] of segments) {
          context.moveTo(ax, ay)
          context.lineTo(bx, by)
        }
        context.stroke()
      }
    }
    context.globalAlpha = 1

    const markerRadius = Math.max(45, viewHeight * 1.8)
    if (viewHeight < 650) {
      for (const node of zone.nodes) {
        if (node.mode === 'subway' ? !showSubway : !showMetro) continue
        if (node.kind === 'station') continue
        if (viewHeight < 120 && Math.hypot(node.x - focus.x, node.z - focus.z) > markerRadius) continue
        const point = this.projected.get(node.id)
        if (!point?.visible) continue
        if (node.mode === 'subway' && node.kind === 'corner' && viewHeight >= 300) continue
        context.beginPath()
        context.arc(point.x, point.y,
          node.kind === 'junction' ? 3 : node.kind === 'portal' ? 3.5 : node.mode === 'metro-north' ? 2.1 : viewHeight < 100 ? 2 : 1.5,
          0, Math.PI * 2)
        context.fillStyle = node.kind === 'portal' ? '#ffce77'
          : node.mode === 'metro-north' ? '#ffd4eb' : node.kind === 'junction' ? '#edfff9' : '#87ffed'
        context.fill()
      }
    }
    for (const node of zone.nodes) {
      if (node.kind !== 'station') continue
      if (viewHeight < 75 && Math.hypot(node.x - focus.x, node.z - focus.z) > markerRadius) continue
      const point = this.projected.get(node.id)
      if (!point?.visible) continue
      context.beginPath()
      context.arc(point.x, point.y, viewHeight > 700 ? 3 : 4.5, 0, Math.PI * 2)
      context.fillStyle = '#10282d'
      context.fill()
      context.lineWidth = 2
      context.strokeStyle = node.mode === 'subway' ? '#8effee' : '#ffb4d7'
      context.stroke()
    }
  }
}
