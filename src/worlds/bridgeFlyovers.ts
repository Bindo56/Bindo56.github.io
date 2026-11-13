import * as THREE from 'three'
import type { BrooklynBridgeData } from './brooklynBridge'

export type FlyoverRoad = {
  name: string
  from: string
  to: string
  bridge?: boolean
  sidewalk?: boolean
  width: number
  points: [number, number][]
}

type Block = { x: number; y: number; z: number; w: number; h: number; d: number; angle: number }
type Bucket = Record<string, Block[]>
const COLORS: Record<string, number> = {
  land: 0x7e7c74,
  deck: 0x60676a,
  road: 0x080808,
  walk: 0x96999a,
  girder: 0x454d51,
  crossbeam: 0x737b7d,
  rail: 0x747d80,
  post: 0x666f72,
  pier: 0x777d7c,
}

/** Remove the raised voxel road under the smooth Brooklyn-side descent. */
export function clearBrooklynRampRaster(
  data: Uint8ClampedArray, pixels: number, step: number, originX: number, originZ: number,
  bridge: BrooklynBridgeData, baseY: number,
) {
  const [[ax, az], [bx, bz]] = bridge.towers
  const dx = bx - ax, dz = bz - az
  const span = Math.hypot(dx, dz)
  const ux = dx / span, uz = dz / span
  const bridgeByte = baseY + bridge.deckRise + 1
  const groundByte = baseY + 1
  for (let z = 0; z < pixels; z++) for (let x = 0; x < pixels; x++) {
    const i = (z * pixels + x) * 4
    if (data[i + 3] !== bridgeByte) continue
    const road = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0
    const walk = data[i] === 150 && data[i + 1] === 150 && data[i + 2] === 150
    if (!road && !walk) continue
    const wx = originX + (x + .5) * step - ax
    const wz = originZ + (z + .5) * step - az
    const along = wx * ux + wz * uz
    const across = wx * uz - wz * ux
    if (along > span + 46 && along < span + 205 && Math.abs(across) < 17) data[i + 3] = groundByte
  }
}

/** Raised road approaches and flyovers. Each 512-block tile gets its own instanced meshes. */
export function buildBridgeFlyovers(
  roads: FlyoverRoad[], deckRise: number, tileSize: number, brooklyn?: BrooklynBridgeData,
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Road flyovers and bridge approaches'
  const tiles = new Map<string, Bucket>()
  const unit = new THREE.BoxGeometry(1, 1, 1)
  const transform = new THREE.Object3D()
  const bridgeRoads = roads.filter((road) => road.bridge && road.width > 0 && road.points.length > 1)
  const bridgeDegree = new Map<string, number>()
  for (const road of bridgeRoads) {
    bridgeDegree.set(road.from, (bridgeDegree.get(road.from) ?? 0) + 1)
    bridgeDegree.set(road.to, (bridgeDegree.get(road.to) ?? 0) + 1)
  }

  const [a, b] = brooklyn?.towers ?? [[0, 0], [0, 0]]
  const bx = b[0] - a[0], bz = b[1] - a[1]
  const span = Math.hypot(bx, bz)
  const ux = span ? bx / span : 0, uz = span ? bz / span : 0
  const brooklynCoords = (x: number, z: number) => ({
    along: (x - a[0]) * ux + (z - a[1]) * uz,
    across: (x - a[0]) * uz - (z - a[1]) * ux,
  })
  const brooklynWays = bridgeRoads.filter((road) => road.name === 'Brooklyn Bridge')
  const brooklynExtent = brooklynWays.flatMap((road) => road.points.map(([x, z]) => brooklynCoords(x, z).along))
  const approachStart = Math.min(-100, ...brooklynExtent)
  const approachEnd = Math.max(span + 100, ...brooklynExtent)
  const deckStart = -46
  const deckEnd = span + 46
  const westJoin = -200
  const eastDescent = approachEnd - 20
  const clamp01 = (value: number) => THREE.MathUtils.clamp(value, 0, 1)
  const bridgeProfile = (along: number) => along < deckStart
    ? clamp01((along - approachStart) / (deckStart - approachStart)) * deckRise
    : along > deckEnd
      ? clamp01((approachEnd - along) / (approachEnd - eastDescent)) * deckRise
      : deckRise

  const add = (kind: keyof typeof COLORS, x: number, y: number, z: number,
    w: number, h: number, d: number, angle = 0) => {
    const id = `${Math.floor(x / tileSize)},${Math.floor(z / tileSize)}`
    let bucket = tiles.get(id)
    if (!bucket) { bucket = {}; tiles.set(id, bucket) }
    ;(bucket[kind] ??= []).push({ x, y, z, w, h, d, angle })
  }

  for (const road of bridgeRoads) {
    const isBrooklyn = road.name === 'Brooklyn Bridge' && span > 0
    const terminalStart = (bridgeDegree.get(road.from) ?? 0) === 1
    const terminalEnd = (bridgeDegree.get(road.to) ?? 0) === 1
    const lengths = [0]
    for (let i = 1; i < road.points.length; i++) {
      const [ax, az] = road.points[i - 1], [cx, cz] = road.points[i]
      lengths.push(lengths[i - 1] + Math.hypot(cx - ax, cz - az))
    }
    const total = lengths.at(-1) ?? 0
    let lastSupport = -30
    for (let i = 1; i < road.points.length; i++) {
      const [ax, az] = road.points[i - 1], [cx, cz] = road.points[i]
      const dx = cx - ax, dz = cz - az
      const length = Math.hypot(dx, dz)
      if (length < .15) continue
      const subdivisions = Math.ceil(length / 7)
      const tangentX = dx / length, tangentZ = dz / length
      const normalX = tangentZ, normalZ = -tangentX
      const angle = Math.atan2(dx, dz)
      for (let part = 0; part < subdivisions; part++) {
        const t = (part + .5) / subdivisions
        const x = ax + dx * t, z = az + dz * t
        const alongRoad = lengths[i - 1] + length * t
        let y: number
        if (isBrooklyn) {
          const { along } = brooklynCoords(x, z)
          // A single full-width deck connects the two mapped carriageways to the landmark.
          if (along > westJoin && along < approachEnd) continue
          y = bridgeProfile(along)
        } else {
          const riseFromStart = terminalStart ? clamp01(alongRoad / 24) : 1
          const riseFromEnd = terminalEnd ? clamp01((total - alongRoad) / 24) : 1
          y = deckRise * Math.min(riseFromStart, riseFromEnd)
        }
        if (y < .35) continue
        const piece = length / subdivisions + .25
        const width = Math.max(road.width, 2.6)
        const shoulder = road.sidewalk ? 2 : 0
        const edge = width / 2 + shoulder + .25
        add('deck', x, y - .34, z, width + shoulder * 2 + .5, .58, piece, angle)
        add('road', x, y + .18, z, width, .22, piece, angle)
        for (const side of [-1, 1]) {
          if (road.sidewalk) add('walk', x + normalX * side * (width / 2 + 1), y + .48,
            z + normalZ * side * (width / 2 + 1), 2, .35, piece, angle)
          add('girder', x + normalX * side * (width / 2 + shoulder), y - .8,
            z + normalZ * side * (width / 2 + shoulder), .42, .95, piece, angle)
          add('rail', x + normalX * side * edge, y + 1.1,
            z + normalZ * side * edge, .22, .22, piece, angle)
          if (part % 3 === 0) add('post', x + normalX * side * edge, y + .63,
            z + normalZ * side * edge, .22, 1.15, .22)
        }
        if (alongRoad - lastSupport >= 27 && y > 1.7) {
          lastSupport = alongRoad
          add('crossbeam', x, y - 1.08, z, width + shoulder * 2 + 1.1, .5, .7, angle)
          add('pier', x, (y - 1.15) / 2, z, 1.15, y - 1.15, 1.15)
        }
      }
    }
  }

  if (span && brooklynWays.length) {
    const angle = Math.atan2(ux, uz)
    const onAxis = (along: number, across = 0) => ({
      x: a[0] + ux * along + uz * across,
      z: a[1] + uz * along - ux * across,
    })
    // The source terrain contains only Manhattan. A small stepped Brooklyn
    // abutment gives the mapped street stubs a ground surface at this landing.
    for (let along = 335; along < 465; along += 5) {
      const width = THREE.MathUtils.lerp(65, 220, clamp01((along - 335) / 130))
      const { x, z } = onAxis(along + 2.5)
      add('land', x, -.015, z, width, .1, 5.2, angle)
    }
    // The mapped lanes are narrow while the landmark deck is 21 blocks wide.
    // These unified ramps cover the voxel bridge surface and join both lanes.
    for (const [start, end] of [[westJoin, deckStart], [deckEnd, approachEnd]]) {
      const steps = Math.ceil((end - start) / 2.5)
      const piece = (end - start) / steps
      for (let i = 0; i < steps; i++) {
        const along = start + (i + .5) * piece
        const t = (along - start) / (end - start)
        const width = start === westJoin ? THREE.MathUtils.lerp(11, 21, t) : THREE.MathUtils.lerp(21, 11, t)
        const y = bridgeProfile(along)
        const { x, z } = onAxis(along)
        add('deck', x, y - .34, z, width + .5, .58, piece + .1, angle)
        add('road', x, y + .08, z, width, .4, piece + .1, angle)
        if (y > 1.2) {
          const footpath = onAxis(along, -4.5)
          add('walk', footpath.x, y + .48, footpath.z, 3.5, .35, piece + .1, angle)
        }
        for (const side of [-1, 1]) {
          const edge = onAxis(along, side * (width / 2 + .2))
          add('girder', edge.x, y - .55, edge.z, .75, 1.2, piece + .1, angle)
          add('rail', edge.x, y + 1.15, edge.z, .4, .3, piece + .1, angle)
          if (i % 4 === 0 && y > .8) add('post', edge.x, y + .65, edge.z, .3, 1.1, .3)
        }
        if (i % 12 === 0 && y > 1.7) {
          add('crossbeam', x, y - 1, z, width + 1, .5, .8, angle)
          add('pier', x, (y - 1.15) / 2, z, 1.4, y - 1.15, 1.4)
        }
      }
    }
  }

  for (const [id, bucket] of tiles) {
    const tile = new THREE.Group()
    tile.name = `Flyover tile ${id}`
    tile.userData.tileId = id
    for (const [kind, blocks] of Object.entries(bucket)) {
      const mesh = new THREE.InstancedMesh(unit, new THREE.MeshBasicMaterial({ color: COLORS[kind], fog: true }), blocks.length)
      mesh.name = `Flyover ${kind}`
      blocks.forEach((block, index) => {
        transform.position.set(block.x, block.y, block.z)
        transform.scale.set(block.w, block.h, block.d)
        transform.rotation.set(0, block.angle, 0)
        transform.updateMatrix()
        mesh.setMatrixAt(index, transform.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      tile.add(mesh)
    }
    group.add(tile)
  }
  return group
}
