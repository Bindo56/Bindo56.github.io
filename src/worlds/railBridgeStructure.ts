import * as THREE from 'three'
import type { SurfaceRail } from './transitNetwork'

type Block = { x: number; y: number; z: number; w: number; h: number; d: number; angle: number }

/** Stylized suspension frames around the mapped subway tracks, one per rail bridge. */
export function buildRailBridgeStructures(ways: SurfaceRail[]): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Manhattan and Williamsburg subway bridge structure'
  const unit = new THREE.BoxGeometry(1, 1, 1)
  const rodUnit = new THREE.CylinderGeometry(1, 1, 1, 4)
  const transform = new THREE.Object3D()
  const up = new THREE.Vector3(0, 1, 0)

  for (const bridgeName of ['Manhattan Bridge', 'Williamsburg Bridge']) {
    const bridgeWays = ways.filter((way) => way.name === bridgeName)
    const points = bridgeWays.flatMap((way) => way.points)
    if (points.length < 2) continue
    let start = points[0], end = points[1], longest = 0
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const length = Math.hypot(points[j][0] - points[i][0], points[j][1] - points[i][1])
      if (length > longest) { longest = length; start = points[i]; end = points[j] }
    }
    const [ax, az] = start, [bx, bz] = end
    const ux = (bx - ax) / longest, uz = (bz - az) / longest
    const nx = uz, nz = -ux
    const angle = Math.atan2(bx - ax, bz - az)
    const deckY = bridgeWays[0].deckY
    const towerHalfSpan = Math.min(82, longest * .15)
    const towerA = longest / 2 - towerHalfSpan
    const towerB = longest / 2 + towerHalfSpan
    const towerHeight = deckY + 25
    const steel = bridgeName === 'Manhattan Bridge' ? 0x89959b : 0x8b6b5a
    const darkSteel = bridgeName === 'Manhattan Bridge' ? 0x495861 : 0x59453d
    const blocks: Record<string, { color: number; items: Block[] }> = {
      steel: { color: steel, items: [] },
      dark: { color: darkSteel, items: [] },
    }
    const add = (shade: keyof typeof blocks, x: number, y: number, z: number,
      w: number, h: number, d: number, rotation = 0) => {
      blocks[shade].items.push({ x, y, z, w, h, d, angle: rotation })
    }
    const pointAt = (along: number, across = 0) => new THREE.Vector3(
      ax + ux * along + nx * across, 0, az + uz * along + nz * across)
    for (const tower of [towerA, towerB]) {
      const center = pointAt(tower)
      for (const side of [-1, 1]) {
        const leg = pointAt(tower, side * 16)
        add('steel', leg.x, towerHeight / 2, leg.z, 2.8, towerHeight, 3.8, angle)
        add('dark', leg.x, deckY + 3, leg.z, 4.2, 1.4, 5.2, angle)
        add('steel', leg.x, towerHeight + 1, leg.z, 3.4, 2, 4.5, angle)
      }
      add('steel', center.x, towerHeight - 1, center.z, 34, 2.2, 4.5, angle)
      add('dark', center.x, deckY + 12, center.z, 33, 1.1, 3, angle)
      for (const across of [-11, 11]) {
        const brace = pointAt(tower, across)
        add('dark', brace.x, deckY + 19, brace.z, 1.3, 12, 3, angle)
      }
    }

    const cableHeight = (along: number) => {
      const low = deckY + 4
      if (along < towerA) return low + (towerHeight - low) * (along / towerA) ** 1.5
      if (along > towerB) return low + (towerHeight - low) * ((longest - along) / (longest - towerB)) ** 1.5
      const t = (along - towerA) / (towerB - towerA)
      return deckY + 8 + (towerHeight - deckY - 8) * (2 * t - 1) ** 2
    }
    const cableMaterial = new THREE.MeshBasicMaterial({ color: darkSteel, fog: true })
    const hangers: { from: THREE.Vector3; to: THREE.Vector3 }[] = []
    for (const side of [-1, 1]) {
      const curvePoints: THREE.Vector3[] = []
      for (let along = 0; along <= longest; along += 4) {
        const p = pointAt(along, side * 16)
        p.y = cableHeight(along)
        curvePoints.push(p)
      }
      const endPoint = pointAt(longest, side * 16)
      endPoint.y = cableHeight(longest)
      curvePoints.push(endPoint)
      const cable = new THREE.Mesh(new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(curvePoints), Math.ceil(longest / 3), .25, 4, false), cableMaterial)
      cable.name = `${bridgeName} suspension cable`
      group.add(cable)
      for (let along = 8; along < longest - 8; along += 12) {
        const top = pointAt(along, side * 16)
        top.y = cableHeight(along)
        const bottom = pointAt(along, side * 16)
        bottom.y = deckY + 1.2
        hangers.push({ from: bottom, to: top })
      }
    }
    const rods = new THREE.InstancedMesh(rodUnit, cableMaterial, hangers.length)
    rods.name = `${bridgeName} cable hangers`
    hangers.forEach(({ from, to }, index) => {
      const direction = to.clone().sub(from)
      transform.position.copy(from).add(to).multiplyScalar(.5)
      transform.scale.set(.12, direction.length(), .12)
      transform.quaternion.setFromUnitVectors(up, direction.normalize())
      transform.updateMatrix()
      rods.setMatrixAt(index, transform.matrix)
    })
    rods.instanceMatrix.needsUpdate = true
    group.add(rods)
    for (const [shade, { color, items }] of Object.entries(blocks)) {
      const mesh = new THREE.InstancedMesh(unit, new THREE.MeshBasicMaterial({ color, fog: true }), items.length)
      mesh.name = `${bridgeName} ${shade} towers`
      items.forEach((item, index) => {
        transform.position.set(item.x, item.y, item.z)
        transform.scale.set(item.w, item.h, item.d)
        transform.rotation.set(0, item.angle, 0)
        transform.updateMatrix()
        mesh.setMatrixAt(index, transform.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
      group.add(mesh)
    }
  }
  return group
}
