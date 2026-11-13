import * as THREE from 'three'

export type VoxelTrainKind = 'subway' | 'metro-north'

type Block = { x: number; y: number; z: number; w: number; h: number; d: number }

/** Reusable, static rolling-stock models. The local origin sits on top of the rails. */
export function buildVoxelTrain(kind: VoxelTrainKind): THREE.Group {
  const train = new THREE.Group()
  train.name = kind === 'subway' ? 'Minecraft-style subway train' : 'Minecraft-style Metro-North train'
  const colors = kind === 'subway' ? {
    shell: 0xb9c9cd, roof: 0x7b9299, end: 0x9eb1b5, sill: 0x536e77,
    stripe: 0x2b8fba, door: 0xd8e2df, seam: 0x547079, glass: 0x203e4d,
    glassGlint: 0x557b87, light: 0xffe4a4, marker: 0xe34e45,
  } : {
    shell: 0xe3e8df, roof: 0xa4b5b6, end: 0xc8d3d0, sill: 0x405869,
    stripe: 0x245b92, door: 0xeef1e8, seam: 0x5c737d, glass: 0x244559,
    glassGlint: 0x608da0, light: 0xffe7ad, marker: 0xe44a4b,
  }
  const palette: Record<string, number> = {
    ...colors,
    undercarriage: 0x293b42,
    wheel: 0x19272d,
    hub: 0x74868b,
    black: 0x14242c,
    sign: kind === 'subway' ? 0xf6ad39 : 0x344f79,
  }
  const blocks = new Map<string, Block[]>()
  const add = (material: string, x: number, y: number, z: number, w: number, h: number, d: number) => {
    const list = blocks.get(material) ?? []
    list.push({ x, y, z, w, h, d })
    blocks.set(material, list)
  }

  const carLength = kind === 'subway' ? 12.4 : 14.2
  const carCenters = [-(carLength + .64) / 2, (carLength + .64) / 2]
  for (const [carIndex, center] of carCenters.entries()) {
    const half = carLength / 2
    const front = carIndex === 0 ? -1 : 1
    const bodyBottom = .83
    const bodyHeight = kind === 'subway' ? 2.68 : 2.82
    const bodyMiddle = bodyBottom + bodyHeight / 2

    add('undercarriage', 0, .74, center, 2.7, .36, carLength - .2)
    add('shell', 0, bodyMiddle, center, 3.05, bodyHeight, carLength)
    add('sill', 0, 1.03, center, 3.14, .27, carLength)
    add('roof', 0, bodyBottom + bodyHeight + .13, center, 3.06, .32, carLength + .08)
    add('end', 0, bodyMiddle, center - front * half, 2.92, bodyHeight - .12, .16)
    add('end', 0, bodyMiddle, center + front * half, 2.92, bodyHeight - .12, .16)

    // Roof-mounted equipment remains square and stepped like the surrounding block city.
    const roofY = bodyBottom + bodyHeight + .39
    for (const offset of [-half * .42, half * .42]) {
      add('roof', 0, roofY, center + offset, 1.84, .3, 1.86)
      add('seam', 0, roofY + .17, center + offset, 1.32, .05, 1.35)
    }

    for (const side of [-1, 1]) {
      const x = side * 1.55
      add('stripe', x, kind === 'subway' ? 1.84 : 2.08, center, .055, .24, carLength - .38)
      const doorOffsets = kind === 'subway' ? [-3.15, 3.15] : [-half + 1.8, half - 1.8]
      for (const offset of doorOffsets) {
        add('seam', x + side * .035, 2.18, center + offset, .045, 2.43, 1.65)
        add('door', x + side * .065, 2.18, center + offset - .39, .045, 2.35, .76)
        add('door', x + side * .065, 2.18, center + offset + .39, .045, 2.35, .76)
        add('glass', x + side * .095, 2.67, center + offset - .39, .025, .83, .56)
        add('glass', x + side * .095, 2.67, center + offset + .39, .025, .83, .56)
        add('glassGlint', x + side * .113, 2.95, center + offset - .52, .015, .12, .16)
        add('glassGlint', x + side * .113, 2.95, center + offset + .26, .015, .12, .16)
      }
      const windows = kind === 'subway' ? [-5.18, -1.38, 1.38, 5.18] : [-4.08, -2.55, -1.02, .51, 2.04, 3.57]
      for (const offset of windows) {
        add('seam', x + side * .025, 2.73, center + offset, .035, 1.04, kind === 'subway' ? 1.34 : 1.17)
        add('glass', x + side * .055, 2.75, center + offset, .03, .86, kind === 'subway' ? 1.17 : 1.02)
        add('glassGlint', x + side * .079, 3.05, center + offset - .3, .013, .11, .16)
      }
      add('marker', x + side * .08, 1.52, center + front * (half - .66), .055, .2, .48)
    }

    for (const bogie of [-half * .66, half * .66]) {
      add('undercarriage', 0, .46, center + bogie, 2.48, .35, 1.72)
      for (const side of [-1, 1]) for (const axle of [-.52, .52]) {
        add('wheel', side * 1.19, .34, center + bogie + axle, .38, .6, .62)
        add('hub', side * 1.39, .34, center + bogie + axle, .035, .19, .2)
      }
    }

    const noseZ = center + front * (half + .095)
    add('black', 0, 2.64, noseZ, 2.63, 1.24, .055)
    for (const side of [-1, 1]) {
      add('glass', side * .69, 2.75, noseZ + front * .045, 1.02, .88, .035)
      add('glassGlint', side * .93, 3.04, noseZ + front * .07, .16, .12, .015)
      add('light', side * 1.04, 1.43, noseZ + front * .07, .36, .23, .08)
      add('marker', side * 1.35, 1.4, noseZ + front * .07, .17, .19, .08)
    }
    add('sign', 0, 3.38, noseZ + front * .08, kind === 'subway' ? .77 : 1.21, .27, .07)
    add('stripe', 0, 1.99, noseZ + front * .08, 2.7, .2, .07)
    add('undercarriage', 0, .64, noseZ + front * .3, .65, .24, .58)
  }

  add('black', 0, 1.12, 0, 1.1, .44, .7)
  add('undercarriage', 0, .47, 0, .82, .18, 1.18)

  const cube = new THREE.BoxGeometry(1, 1, 1)
  const transform = new THREE.Object3D()
  for (const [role, parts] of blocks) {
    const mesh = new THREE.InstancedMesh(cube, new THREE.MeshBasicMaterial({ color: palette[role], fog: true }), parts.length)
    mesh.name = `${kind} ${role}`
    mesh.frustumCulled = false
    parts.forEach((part, i) => {
      transform.position.set(part.x, part.y, part.z)
      transform.scale.set(part.w, part.h, part.d)
      transform.updateMatrix()
      mesh.setMatrixAt(i, transform.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    train.add(mesh)
  }
  return train
}
