import * as THREE from 'three'

export type BrooklynBridgeData = {
  towers: [[number, number], [number, number]]
  deckRise: number
}

/** A deliberately block-built silhouette of Brooklyn Bridge, aligned to the OSM deck. */
export function buildBrooklynBridge(data: BrooklynBridgeData): THREE.Group {
  const [[ax, az], [bx, bz]] = data.towers
  const dx = bx - ax
  const dz = bz - az
  const span = Math.hypot(dx, dz)
  const deckY = data.deckRise
  const group = new THREE.Group()
  group.name = 'Brooklyn Bridge — block-built towers and suspension'
  group.position.set(ax, 0, az)
  group.rotation.y = Math.atan2(dx, dz)

  const stoneColours = [0xaaa89d, 0xbcb9ad, 0x8f908a, 0xc9c5b8]
  const stoneBlocks: Array<Array<{ x: number; y: number; z: number; w: number; h: number; d: number }>> = stoneColours.map(() => [])
  const stone = (shade: number, x: number, y: number, z: number, w: number, h: number, d: number) => {
    stoneBlocks[shade].push({ x, y, z, w, h, d })
  }
  for (const towerZ of [0, span]) {
    // Three masonry piers leave the bridge's two pointed Gothic portals open.
    for (const pierX of [-9, 0, 9]) {
      stone(2, pierX, 2, towerZ, 4.4, 4, 6.5)
      for (let y = 4; y < 28; y += 2) {
        const upper = y >= 20
        stone((y / 2 + Math.abs(pierX)) % 3 === 0 ? 1 : 0, pierX, y + 1, towerZ,
          upper ? 3.1 : 3.5, 2, upper ? 4.4 : 5.2)
      }
      stone(3, pierX, 28.8, towerZ, 3.5, 1.6, 5.2)
      stone(2, pierX, 30.4, towerZ, 3.1, 1.6, 4.8)
    }
    for (const openingX of [-4.5, 4.5]) {
      for (let course = 0; course < 5; course += 1) {
        const inset = .7 + course * .45
        const y = 19 + course
        stone(course % 2, openingX - 3 + inset / 2, y, towerZ, inset, 1.15, 5.2)
        stone((course + 1) % 2, openingX + 3 - inset / 2, y, towerZ, inset, 1.15, 5.2)
      }
    }
    stone(1, 0, 26, towerZ, 22.5, 3.2, 5.4)
    stone(2, 0, 31.7, towerZ, 23.5, 1.1, 6)
    for (const battlementX of [-10, -6, -2, 2, 6, 10]) {
      stone(1, battlementX, 32.7, towerZ, 2, 1.1, 6)
    }
    for (const buttressX of [-11.4, 11.4]) for (const faceZ of [-3.4, 3.4]) {
      stone(2, buttressX, 9, towerZ + faceZ, 1.5, 18, 1.5)
    }
  }
  const unitBox = new THREE.BoxGeometry(1, 1, 1)
  const transform = new THREE.Object3D()
  stoneBlocks.forEach((blocks, shade) => {
    const mesh = new THREE.InstancedMesh(unitBox, new THREE.MeshBasicMaterial({ color: stoneColours[shade], fog: true }), blocks.length)
    mesh.name = `Brooklyn Bridge granite shade ${shade + 1}`
    blocks.forEach((block, index) => {
      transform.position.set(block.x, block.y, block.z)
      transform.scale.set(block.w, block.h, block.d)
      transform.rotation.set(0, 0, 0)
      transform.updateMatrix()
      mesh.setMatrixAt(index, transform.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    group.add(mesh)
  })

  const deckStart = -46
  const deckEnd = span + 46
  const deckLength = deckEnd - deckStart
  const addBeam = (name: string, colour: number, x: number, y: number, z: number, w: number, h: number, d: number) => {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: colour, fog: true }))
    beam.name = name
    beam.position.set(x, y, z)
    group.add(beam)
  }
  addBeam('black carriageway deck', 0x050505, 0, deckY + .08, (deckStart + deckEnd) / 2, 21, .4, deckLength)
  addBeam('raised grey footpath', 0x969696, -4.5, deckY + .48, (deckStart + deckEnd) / 2, 3.5, .35, deckLength)
  for (const side of [-1, 1]) {
    addBeam('steel side truss', 0x555b5b, side * 10.65, deckY - .55, (deckStart + deckEnd) / 2, .85, 1.4, deckLength)
    addBeam('outer parapet', 0x838783, side * 10.7, deckY + 1.15, (deckStart + deckEnd) / 2, .45, .35, deckLength)
  }

  const cableMaterial = new THREE.MeshBasicMaterial({ color: 0x666a68, fog: true })
  const towerCableY = 30.6
  const lowCableY = deckY + 3.2
  const midCableY = deckY + 9
  const anchorLength = 105
  const cableHeight = (z: number) => {
    if (z < 0) {
      const t = THREE.MathUtils.clamp((z + anchorLength) / anchorLength, 0, 1)
      return lowCableY + (towerCableY - lowCableY) * t ** 1.7
    }
    if (z > span) {
      const t = THREE.MathUtils.clamp((span + anchorLength - z) / anchorLength, 0, 1)
      return lowCableY + (towerCableY - lowCableY) * t ** 1.7
    }
    const t = z / span
    return midCableY + (towerCableY - midCableY) * (2 * t - 1) ** 2
  }
  for (const cableX of [-10, -7.6, 7.6, 10]) {
    const points: THREE.Vector3[] = []
    for (let z = -anchorLength; z <= span + anchorLength; z += 3) {
      points.push(new THREE.Vector3(cableX, cableHeight(z), z))
    }
    points.push(new THREE.Vector3(cableX, lowCableY, span + anchorLength))
    const cable = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.ceil((span + 2 * anchorLength) / 2), .24, 4, false),
      cableMaterial,
    )
    cable.name = 'faceted suspension cable'
    group.add(cable)
  }

  const rodTransforms: Array<{ from: THREE.Vector3; to: THREE.Vector3; radius: number }> = []
  const rod = (from: THREE.Vector3, to: THREE.Vector3, radius = .12) => rodTransforms.push({ from, to, radius })
  for (let z = deckStart + 3; z < deckEnd; z += 7) {
    for (const cableX of [-10, -7.6, 7.6, 10]) {
      const top = cableHeight(z)
      if (top > deckY + 2) rod(new THREE.Vector3(cableX, deckY + 1.1, z), new THREE.Vector3(cableX, top, z), .105)
    }
    for (const side of [-1, 1]) rod(new THREE.Vector3(side * 10.7, deckY + .2, z), new THREE.Vector3(side * 10.7, deckY + 1.2, z), .18)
  }
  for (const towerZ of [0, span]) for (const side of [-1, 1]) for (const reach of [18, 36, 54, 72]) {
    const z = towerZ + (towerZ === 0 ? 1 : -1) * reach
    if (z > 0 && z < span) rod(new THREE.Vector3(side * 8.8, 29.5, towerZ), new THREE.Vector3(side * 8.8, deckY + 1.1, z), .16)
  }
  const unitRod = new THREE.CylinderGeometry(1, 1, 1, 4)
  const rods = new THREE.InstancedMesh(unitRod, cableMaterial, rodTransforms.length)
  rods.name = 'block-style suspenders and diagonal stays'
  const upright = new THREE.Vector3(0, 1, 0)
  rodTransforms.forEach(({ from, to, radius }, index) => {
    const direction = to.clone().sub(from)
    transform.position.copy(from).add(to).multiplyScalar(.5)
    transform.scale.set(radius, direction.length(), radius)
    transform.quaternion.setFromUnitVectors(upright, direction.normalize())
    transform.updateMatrix()
    rods.setMatrixAt(index, transform.matrix)
  })
  rods.instanceMatrix.needsUpdate = true
  group.add(rods)
  return group
}
