import * as THREE from 'three'

export type StationLandmark = { id: string; name: string; x: number; z: number }

export const STATION_LANDMARKS: StationLandmark[] = [
  { id: 'grand-central', name: 'Grand Central Terminal', x: -239, z: -17 },
  { id: 'moynihan', name: 'Moynihan / Penn Station', x: -676, z: 273 },
  { id: 'times-square', name: 'Times Square–42 St', x: -538, z: 36 },
  { id: 'fulton', name: 'Fulton Center', x: -263, z: 1775 },
  { id: 'oculus', name: 'World Trade Center Oculus', x: -343, z: 1774 },
]

/** Conservative solid footprints for the above-ground station models. */
export const STATION_COLLIDERS = [
  { minX: -259.5, minZ: -35, maxX: -218.5, maxZ: 2.5, top: 27.6 },
  { minX: -715, minZ: 252.5, maxX: -637, maxZ: 293.5, top: 12.5 },
  { minX: -543.5, minZ: 32.5, maxX: -532.5, maxZ: 39.5, top: 5.8 },
  { minX: -272.25, minZ: 1765, maxX: -253.75, maxZ: 1785, top: 13.2 },
  { minX: -362.75, minZ: 1765.85, maxX: -324.25, maxZ: 1781.15, top: 26.1 },
] as const

type Block = { x: number; y: number; z: number; w: number; h: number; d: number }
type Palette = Record<string, { color: number; blocks: Block[] }>
export type StationLandmarkScene = { group: THREE.Group; grandCentralDetail: THREE.Group }

/** Block-built above-ground landmark exteriors; underground platforms are intentionally absent. */
export function buildStationLandmarks(): StationLandmarkScene {
  const group = new THREE.Group()
  group.name = 'Five major Manhattan station exteriors'
  const makePalette = (): Palette => ({
    stone: { color: 0xc8b99b, blocks: [] }, trim: { color: 0xf0ddba, blocks: [] }, shadow: { color: 0x8d816f, blocks: [] }, glass: { color: 0x406575, blocks: [] }, dark: { color: 0x263b46, blocks: [] }, steel: { color: 0x707c83, blocks: [] }, white: { color: 0xf1f1e7, blocks: [] },
    clock: { color: 0xe9c976, blocks: [] }, rail: { color: 0x393c3c, blocks: [] },
  })
  const palette = makePalette()
  const grandDetailPalette = makePalette()
  const grandCentralDetail = new THREE.Group()
  grandCentralDetail.name = 'Grand Central close LOD'
  const block = (shade: keyof typeof palette, x: number, y: number, z: number, w: number, h: number, d: number) => {
    palette[shade].blocks.push({ x, y, z, w, h, d })
  }
  const detailBlock = (shade: keyof typeof palette, x: number, y: number, z: number, w: number, h: number, d: number) => {
    grandDetailPalette[shade].blocks.push({ x, y, z, w, h, d })
  }

  // Grand Central: pale stone terminal, entrance colonnade, tall arched windows, clock.
  {
    const x = -239, z = -17
    block('stone', x, 10.5, z, 39, 21, 34)
    block('trim', x, 21.8, z, 41, 1.4, 36)
    block('shadow', x, 23, z, 38, 1, 32)
    block('trim', x, 23.8, z, 10, .5, 26)
    block('glass', x, 24.15, z, 7.5, .35, 23)
    for (const dz of [-11, -7, -3, 1, 5, 9, 13]) detailBlock('steel', x, 24.4, z + dz, 8.2, .3, .45)
    for (const dx of [-13, -9, 9, 13]) detailBlock('shadow', x + dx, 23.8, z, 1.1, .6, 25)
    for (const dx of [-16, -12, -8, -4, 0, 4, 8, 12, 16]) {
      detailBlock('trim', x + dx, 9, z + 17.4, 1.2, 17, 1.6)
      detailBlock('trim', x + dx, 17.9, z + 17.4, 2.1, 1, 1.9)
    }
    for (const dx of [-14, -10, -6, -2, 2, 6, 10, 14]) {
      detailBlock('glass', x + dx, 12.2, z + 18.3, 2.2, 9.6, .3)
      detailBlock('dark', x + dx, 5.1, z + 18.4, 2.1, 6.4, .4)
    }
    detailBlock('trim', x, 19.7, z + 18.4, 11, 2.7, 1.8)
    for (let step = 0; step < 4; step++)
      detailBlock('trim', x, 22.1 + step * 1.1, z + 18.4, 11 - step * 2.2, 1.1, 1.8)
    detailBlock('clock', x, 19.7, z + 19.5, 2.4, 2.4, .35)
    detailBlock('dark', x, 19.7, z + 19.73, .18, 1.4, .1)
    detailBlock('dark', x + .4, 19.5, z + 19.74, 1, .18, .1)
    for (const dx of [-17, 17]) detailBlock('trim', x + dx, 25.2, z + 16.2, 4, 4.7, 3.2)
  }

  // Farley Post Office houses Moynihan Train Hall; the glazed hall roof is above street.
  {
    const x = -676, z = 273
    block('stone', x, 4.4, z, 75, 8.8, 38)
    block('trim', x, 9.2, z, 78, 1.1, 41)
    block('shadow', x, 9.85, z, 72, .6, 34)
    for (let dx = -34; dx <= 34; dx += 4) {
      block('trim', x + dx, 5.1, z + 20, 1.2, 9.3, 1.7)
      block('dark', x + dx + 2, 4.2, z + 20.1, 2.2, 5.7, .4)
    }
    block('glass', x, 10.8, z, 53, 1, 23)
    for (let dx = -26; dx <= 26; dx += 5) block('steel', x + dx, 11.4, z, .55, .5, 24)
    for (let dz = -11; dz <= 11; dz += 5.5) block('steel', x, 11.4, z + dz, 54, .5, .55)
    block('trim', x, 10.7, z + 21.1, 24, 2.1, 1)
  }

  // Times Square has surface entrances rather than a freestanding terminal.
  {
    const x = -538, z = 36
    block('steel', x, .35, z, 11, .7, 7)
    block('dark', x, 1.1, z, 8, .8, 5.2)
    block('glass', x, 4.2, z, 10, .7, 6.5)
    for (const dx of [-4.5, 4.5]) for (const dz of [-2.7, 2.7]) block('steel', x + dx, 2.4, z + dz, .45, 4.2, .45)
    block('steel', x, 2.3, z + 3.4, 10.8, .4, .45)
    block('rail', x, 2.3, z - 3.4, 10.8, .4, .45)
    block('dark', x, 5.2, z + 3.35, 8.5, 1.2, .5)
  }

  // Fulton Center: compact transparent rotunda with a faceted glazed crown.
  {
    const x = -263, z = 1775
    block('stone', x, 3.2, z, 16.5, 6.4, 18)
    for (const dx of [-6, -3, 0, 3, 6]) {
      block('glass', x + dx, 3.5, z + 9.1, 2, 4.7, .35)
      block('glass', x + dx, 3.5, z - 9.1, 2, 4.7, .35)
    }
    block('trim', x, 6.7, z, 18.5, .8, 20)
    for (let tier = 0; tier < 5; tier++) {
      const width = 17 - tier * 2.2
      block(tier % 2 ? 'steel' : 'glass', x, 7.6 + tier * 1.05, z, width, 1.1, 18 - tier * 2.1)
    }
    block('white', x, 12.9, z, 7.6, .55, 8)
  }

  // Oculus: white stepped ribs read as the winged skylight from street level.
  {
    // The original raster roof reaches Y 20. Cover its whole footprint and keep
    // each exposed layer above that height, so coplanar faces cannot shimmer.
    const x = -343.5, z = 1773.5
    block('white', x, 10.75, z, 38.5, 21.5, 14.5)
    block('glass', x, 22.4, z, 32, 1.4, 6.5)
    for (let i = -8; i <= 8; i++) {
      const dx = i * 2.1
      const reach = 8.5 - Math.abs(i) * .24
      block('white', x + dx, 23.5 + Math.abs(i) * .17, z - reach / 2 - 3, .95, 1, reach)
      block('white', x + dx, 23.5 + Math.abs(i) * .17, z + reach / 2 + 3, .95, 1, reach)
      block('white', x + dx, 17, z - 8.2, .95, 10, .8)
      block('white', x + dx, 17, z + 8.2, .95, 10, .8)
    }
    block('white', x, 25.7, z, 36, .7, 1)
  }

  const box = new THREE.BoxGeometry(1, 1, 1)
  const transform = new THREE.Object3D()
  for (const [target, source] of [[group, palette], [grandCentralDetail, grandDetailPalette]] as const) {
    for (const [shade, { color, blocks }] of Object.entries(source)) {
      if (!blocks.length) continue
      const mesh = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color, fog: true }), blocks.length)
      mesh.name = `Station masonry ${shade}`
      blocks.forEach((item, index) => {
        transform.position.set(item.x, item.y, item.z)
        transform.scale.set(item.w, item.h, item.d)
        transform.rotation.set(0, 0, 0)
        transform.updateMatrix()
        mesh.setMatrixAt(index, transform.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
      target.add(mesh)
    }
  }
  grandCentralDetail.visible = false
  group.add(grandCentralDetail)
  return { group, grandCentralDetail }
}
