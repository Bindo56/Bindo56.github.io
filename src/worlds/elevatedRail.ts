import * as THREE from 'three'
import type { SurfaceRail } from './transitNetwork'
import { buildRailBridgeStructures } from './railBridgeStructure'

type Beam = { x: number; y: number; z: number; width: number; height: number; length: number; angle: number }

/** Only OSM bridge-tagged subway ways are rendered above the street. */
export function buildElevatedRail(ways: SurfaceRail[]): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Above-ground subway rail on Manhattan and Williamsburg bridges'
  const buckets: Record<string, { color: number; beams: Beam[] }> = {
    deck: { color: 0x42494b, beams: [] },
    edge: { color: 0x879094, beams: [] },
    sleeper: { color: 0x594c3e, beams: [] },
    rail: { color: 0xaeb7b7, beams: [] },
    pier: { color: 0x697276, beams: [] },
    girder: { color: 0x343c40, beams: [] },
    crossbeam: { color: 0x788287, beams: [] },
  }
  const add = (kind: keyof typeof buckets, x: number, y: number, z: number,
    width: number, height: number, length: number, angle = 0) => {
    buckets[kind].beams.push({ x, y, z, width, height, length, angle })
  }
  for (const way of ways) {
    const lengths = way.points.slice(1).map(([bx, bz], index) => {
      const [ax, az] = way.points[index]
      return Math.hypot(bx - ax, bz - az)
    })
    const totalLength = lengths.reduce((sum, length) => sum + length, 0)
    let beforeSegment = 0
    let lastSupport = -30
    for (let i = 1; i < way.points.length; i++) {
      const [ax, az] = way.points[i - 1]
      const [bx, bz] = way.points[i]
      const dx = bx - ax, dz = bz - az
      const length = Math.hypot(dx, dz)
      if (length < .25) continue
      const ux = dx / length, uz = dz / length
      const nx = uz, nz = -ux
      const angle = Math.atan2(dx, dz)
      const x = (ax + bx) / 2, z = (az + bz) / 2
      const y = way.deckY
      add('deck', x, y, z, 3.2, .55, length + .1, angle)
      for (const side of [-1, 1]) {
        add('edge', x + nx * side * 1.52, y + .54, z + nz * side * 1.52, .24, .62, length + .1, angle)
        add('rail', x + nx * side * .72, y + .67, z + nz * side * .72, .17, .2, length + .1, angle)
        add('girder', x + nx * side * 1.22, y - .66, z + nz * side * 1.22, .4, .92, length + .1, angle)
      }
      for (let along = 0; along < length; along += 2.6) {
        const offset = along - length / 2
        add('sleeper', x + ux * offset, y + .42, z + uz * offset, 2.25, .2, .4, angle)
      }
      for (let along = 0; along < length; along += 11) {
        const offset = along - length / 2
        add('crossbeam', x + ux * offset, y - .87, z + uz * offset, 3.5, .32, .42, angle)
      }
      // Columns support land approaches; river spans use continuous steel girders.
      for (let along = 12; along < length - 8; along += 20) {
        const onWay = beforeSegment + along
        if (onWay - lastSupport < 20 || (onWay > 55 && onWay < totalLength - 55)) continue
        lastSupport = onWay
        const offset = along - length / 2
        const px = x + ux * offset, pz = z + uz * offset
        add('crossbeam', px, y - 1.16, pz, 4.1, .5, .7, angle)
        for (const side of [-1, 1]) {
          add('pier', px + nx * side * 1.3, (y - 1.3) / 2,
            pz + nz * side * 1.3, .78, y - 1.3, .78)
        }
      }
      beforeSegment += length
    }
  }
  const unit = new THREE.BoxGeometry(1, 1, 1)
  const transform = new THREE.Object3D()
  for (const [name, { color, beams }] of Object.entries(buckets)) {
    if (!beams.length) continue
    const mesh = new THREE.InstancedMesh(unit, new THREE.MeshBasicMaterial({ color, fog: true }), beams.length)
    mesh.name = `Elevated rail ${name}`
    beams.forEach((beam, index) => {
      transform.position.set(beam.x, beam.y, beam.z)
      transform.scale.set(beam.width, beam.height, beam.length)
      transform.rotation.set(0, beam.angle, 0)
      transform.updateMatrix()
      mesh.setMatrixAt(index, transform.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    group.add(mesh)
  }
  group.add(buildRailBridgeStructures(ways))
  return group
}
