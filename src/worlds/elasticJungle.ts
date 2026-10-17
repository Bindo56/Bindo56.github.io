import * as THREE from 'three'

export type JungleProp = {
  root: THREE.Group
  kind: 'land' | 'tree' | 'stone' | 'bush' | 'mushroom' | 'flower' | 'fern' | 'log' | 'pond' | 'lily' | 'ruin'
  baseY: number
  weight: number
}

const leafGeometry = new THREE.IcosahedronGeometry(1, 1)
const pebbleGeometry = new THREE.DodecahedronGeometry(1, 0)
const flowerPetalGeometry = new THREE.IcosahedronGeometry(1, 0)
const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 7)

// Four discrete light values give every model the same hand-drawn, cartoon shading.
const toonSteps = new Uint8Array([
  64, 64, 64, 255,
  124, 124, 124, 255,
  191, 191, 191, 255,
  255, 255, 255, 255,
])
const toonGradient = new THREE.DataTexture(toonSteps, 4, 1, THREE.RGBAFormat)
toonGradient.magFilter = THREE.NearestFilter
toonGradient.minFilter = THREE.NearestFilter
toonGradient.generateMipmaps = false
toonGradient.needsUpdate = true

const material = (color: number) =>
  new THREE.MeshToonMaterial({ color, gradientMap: toonGradient })

const palette = {
  earth: material(0x184d4c),
  earthLight: material(0x27776a),
  earthFacet: material(0x3b8d77),
  grass: material(0x5bc68e),
  grassLight: material(0x88dd99),
  grassDark: material(0x2da87f),
  path: material(0x99c89a),
  trunk: material(0xb98263),
  trunkLight: material(0xd6a47a),
  trunkDark: material(0x815c50),
  leafDark: material(0x1ea884),
  leaf: material(0x42c89c),
  leafLight: material(0x92d986),
  leafLime: material(0xb8e779),
  stoneDark: material(0x537f7e),
  stone: material(0x83aaa3),
  stoneLight: material(0xb0d0ba),
  pondBank: material(0x376f66),
  water: material(0x55bdba),
  waterLight: material(0x9cddd1),
  coral: material(0xff8d74),
  pink: material(0xffa9af),
  mango: material(0xffcb6e),
  cream: material(0xffedb8),
}

function addMesh(
  parent: THREE.Group,
  geometry: THREE.BufferGeometry,
  surface: THREE.Material,
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = 1,
  sz = 1,
) {
  const mesh = new THREE.Mesh(geometry, surface)
  mesh.position.set(x, y, z)
  mesh.scale.set(sx, sy, sz)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function segment(
  parent: THREE.Group,
  surface: THREE.Material,
  from: THREE.Vector3,
  to: THREE.Vector3,
  baseRadius: number,
  tipRadius: number,
  sides = 7,
) {
  const direction = to.clone().sub(from)
  const mesh = addMesh(
    parent,
    new THREE.CylinderGeometry(tipRadius, baseRadius, direction.length(), sides),
    surface,
    (from.x + to.x) / 2,
    (from.y + to.y) / 2,
    (from.z + to.z) / 2,
  )
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  return mesh
}

function addProp(
  scene: THREE.Scene,
  props: JungleProp[],
  kind: JungleProp['kind'],
  x: number,
  y: number,
  z: number,
  weight: number,
) {
  const root = new THREE.Group()
  root.position.set(x, y, z)
  root.name = `${kind}-${props.filter(prop => prop.kind === kind).length + 1}`
  root.userData.kind = kind
  scene.add(root)
  props.push({ root, kind, baseY: y, weight })
  return root
}

function islandGeometry(top: number, bottom: number, height: number) {
  const geometry = new THREE.CylinderGeometry(top, bottom, height, 24, 1)
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const z = positions.getZ(i)
    const angle = Math.atan2(z, x)
    const wobble = 1 + Math.sin(angle * 3 + 0.5) * 0.022 + Math.cos(angle * 7 - 0.6) * 0.014
    positions.setX(i, x * wobble)
    positions.setZ(i, z * wobble)
  }
  geometry.computeVertexNormals()
  return geometry
}

function groundPatch(parent: THREE.Group, x: number, z: number, sx: number, sz: number, surface: THREE.Material) {
  const patch = addMesh(parent, new THREE.CircleGeometry(1, 12), surface, x, 1.119, z, sx, sz, 1)
  patch.rotation.x = -Math.PI / 2
  patch.castShadow = false
  return patch
}

function addIsland(scene: THREE.Scene, props: JungleProp[]) {
  // The island root sits at its lowest point, leaving the entire island above its scale pivot.
  const land = addProp(scene, props, 'land', 0, -1.05, 0, 3.5)
  addMesh(land, islandGeometry(7.05, 6.48, 0.98), palette.earth, 0, 0.49, 0)
  addMesh(land, islandGeometry(7.13, 6.93, 0.25), palette.earthLight, 0, 0.915, 0)
  addMesh(land, islandGeometry(7.18, 7.12, 0.12), palette.grass, 0, 1.055, 0)

  // Broad pale footprints form a path through the center of the clearing.
  for (const [x, z, sx, sz] of [
    [-1.78, 4.65, 1.16, 0.57], [-1.25, 3.70, 1.04, 0.62],
    [-0.75, 2.72, 1.07, 0.57], [-0.48, 1.70, 0.91, 0.49],
    [-0.60, 0.73, 0.92, 0.50], [-0.36, -0.22, 0.92, 0.49],
    [-0.12, -1.18, 0.84, 0.46],
  ] as const) groundPatch(land, x, z, sx, sz, palette.path)

  const tufts: [number, number, number][] = [
    [-5.85, -0.55, 0.77], [-5.35, 3.35, 0.87], [-3.03, -5.30, 0.77],
    [0.75, -5.65, 0.85], [3.40, -4.92, 0.86], [5.70, -1.55, 0.73],
    [5.53, 3.32, 0.77], [2.05, 5.38, 0.95], [-3.55, 4.75, 0.89],
  ]
  for (const [x, z, size] of tufts) {
    groundPatch(land, x, z, size, size * 0.58, palette.grassLight)
  }

  // Side facets make the island read as a thick, soft-edged chunk from the fixed camera.
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2
    const radius = 6.71
    const facet = addMesh(
      land,
      pebbleGeometry,
      i % 3 === 0 ? palette.earthFacet : palette.earthLight,
      Math.cos(angle) * radius,
      0.63,
      Math.sin(angle) * radius,
      0.55,
      0.20 + (i % 3) * 0.035,
      0.30,
    )
    facet.rotation.y = -angle
  }
}

function addTree(
  scene: THREE.Scene,
  props: JungleProp[],
  x: number,
  z: number,
  height: number,
  crown: number,
  variant: number,
) {
  const root = addProp(scene, props, 'tree', x, 0.06, z, 1.3 + crown * 0.2)
  const trunk = addMesh(root, new THREE.CylinderGeometry(0.13, 0.24, 1, 7), palette.trunk, 0, height * 0.48, 0, 1, height * 0.96, 1)
  trunk.rotation.z = variant % 2 === 0 ? 0.035 : -0.045
  addMesh(root, new THREE.ConeGeometry(0.35, 0.46, 7), palette.trunkLight, 0, 0.19, 0, 1, 1, 1)

  const offset = variant % 2 ? -0.16 : 0.18
  const canopyY = height + 0.21
  addMesh(root, leafGeometry, palette.leafDark, offset - 0.44 * crown, canopyY - 0.27, -0.11, 0.74 * crown, 0.56 * crown, 0.71 * crown)
  addMesh(root, leafGeometry, palette.leaf, offset + 0.35 * crown, canopyY - 0.23, 0.08, 0.86 * crown, 0.64 * crown, 0.74 * crown)
  addMesh(root, leafGeometry, palette.leafLight, offset - 0.12, canopyY + 0.15 * crown, -0.05, 0.92 * crown, 0.70 * crown, 0.84 * crown)
  addMesh(root, leafGeometry, palette.leafLime, offset + 0.16 * crown, canopyY + 0.47 * crown, -0.11, 0.51 * crown, 0.39 * crown, 0.49 * crown)

  // Sparse fruit catches the warm light without turning the trees into rigid ornaments.
  const fruitSize = 0.105 * crown
  addMesh(root, pebbleGeometry, palette.mango, offset - 0.53 * crown, canopyY - 0.47 * crown, 0.55 * crown, fruitSize, fruitSize * 1.15, fruitSize)
  addMesh(root, pebbleGeometry, palette.coral, offset + 0.48 * crown, canopyY - 0.17 * crown, 0.58 * crown, fruitSize * 0.8, fruitSize, fruitSize * 0.8)
}

function addPalm(scene: THREE.Scene, props: JungleProp[], x: number, z: number, height: number, variant: number) {
  const root = addProp(scene, props, 'tree', x, 0.07, z, 1.35)
  const lean = variant % 2 ? -0.34 : 0.36
  const crown = new THREE.Vector3(lean, height, 0)
  segment(root, palette.trunkDark, new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * 0.35, height * 0.44, 0), 0.21, 0.18)
  segment(root, palette.trunk, new THREE.Vector3(lean * 0.35, height * 0.44, 0), crown, 0.18, 0.11)
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + variant * 0.25
    const radius = i % 2 ? 1.22 : 1.42
    const outer = new THREE.Vector3(crown.x + Math.cos(angle) * radius, height - 0.34, Math.sin(angle) * radius)
    segment(root, palette.grassDark, crown, outer, 0.055, 0.015, 5)
    const leaf = addMesh(root, leafGeometry, i % 3 ? palette.leaf : palette.leafLime,
      (crown.x + outer.x) / 2, height - 0.12, outer.z / 2,
      radius * 0.47, 0.10, 0.31)
    leaf.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), outer.clone().sub(crown).normalize())
  }
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2
    addMesh(root, pebbleGeometry, palette.mango, crown.x + Math.cos(angle) * 0.19, height - 0.15, Math.sin(angle) * 0.19, 0.13, 0.15, 0.13)
  }
}

function addVineTree(scene: THREE.Scene, props: JungleProp[], x: number, z: number, height: number, variant: number) {
  const root = addProp(scene, props, 'tree', x, 0.07, z, 1.85)
  const top = new THREE.Vector3(variant % 2 ? -0.16 : 0.20, height, 0)
  segment(root, palette.trunkDark, new THREE.Vector3(0, 0, 0), top, 0.31, 0.16, 8)
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + 0.3
    segment(root, palette.trunk, new THREE.Vector3(0, 0.55, 0), new THREE.Vector3(Math.cos(angle) * 0.59, 0.07, Math.sin(angle) * 0.59), 0.15, 0.025)
  }
  const crownY = height + 0.15
  addMesh(root, leafGeometry, palette.leafDark, top.x - 0.55, crownY - 0.17, -0.14, 0.78, 0.53, 0.69)
  addMesh(root, leafGeometry, palette.leaf, top.x + 0.46, crownY + 0.06, 0.15, 0.84, 0.57, 0.73)
  addMesh(root, leafGeometry, palette.leafLight, top.x - 0.10, crownY + 0.44, 0, 0.86, 0.54, 0.71)
  addMesh(root, leafGeometry, palette.leafLime, top.x + 0.16, crownY + 0.75, -0.09, 0.50, 0.30, 0.47)
  for (let i = 0; i < 3; i++) {
    const vx = top.x + (i - 1) * 0.67
    const vz = i === 1 ? 0.42 : -0.17
    const start = new THREE.Vector3(vx, crownY - 0.02, vz)
    const mid = new THREE.Vector3(vx + (i - 1) * 0.10, crownY - 0.57, vz + 0.05)
    const end = new THREE.Vector3(vx + (i - 1) * 0.16, crownY - 1.18 - (i % 2) * 0.18, vz + 0.10)
    segment(root, palette.grassDark, start, mid, 0.034, 0.028, 5)
    segment(root, palette.grassDark, mid, end, 0.028, 0.014, 5)
    addMesh(root, leafGeometry, palette.leafLight, end.x + 0.10, end.y + 0.15, end.z, 0.15, 0.07, 0.08).rotation.z = -0.35
  }
}

function addStone(scene: THREE.Scene, props: JungleProp[], x: number, z: number, width: number, variant: number) {
  const root = addProp(scene, props, 'stone', x, 0.07, z, 1.1 + width * 0.3)
  const height = width * (variant % 3 === 0 ? 0.88 : variant % 3 === 1 ? 0.59 : 0.74)
  const main = addMesh(root, pebbleGeometry, variant % 2 ? palette.stone : palette.stoneDark, 0, height * 0.83, 0, width, height, width * (variant % 3 === 0 ? 0.68 : 0.83))
  main.rotation.set(0.08, variant * 0.6, -0.07)
  addMesh(root, pebbleGeometry, palette.stoneLight, -width * 0.23, height * 1.38, width * 0.16, width * 0.40, height * 0.17, width * 0.34)
  if (width > 0.52) {
    addMesh(root, pebbleGeometry, palette.stoneDark, width * 0.52, height * 0.18, width * 0.21, width * 0.39, height * 0.34, width * 0.36)
  }
}

function addFern(scene: THREE.Scene, props: JungleProp[], x: number, z: number, size: number, variant: number) {
  const root = addProp(scene, props, 'fern', x, 0.07, z, 0.55)
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + variant * 0.18
    const radius = size * (i % 2 ? 0.72 : 0.92)
    const tip = new THREE.Vector3(Math.cos(angle) * radius, size * (i % 2 ? 0.51 : 0.69), Math.sin(angle) * radius)
    segment(root, palette.grassDark, new THREE.Vector3(0, 0.04, 0), tip, 0.035, 0.012, 5)
    const blade = addMesh(root, leafGeometry, i % 3 === 0 ? palette.leafLime : palette.leafLight,
      tip.x * 0.65, tip.y * 0.66 + 0.07, tip.z * 0.65,
      size * 0.15, size * 0.38, size * 0.12)
    blade.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().normalize())
  }
}

function addLog(scene: THREE.Scene, props: JungleProp[], x: number, z: number, length: number, angle: number) {
  const root = addProp(scene, props, 'log', x, 0.07, z, 1.20)
  root.rotation.y = angle
  segment(root, palette.trunkDark, new THREE.Vector3(-length / 2, 0.27, 0), new THREE.Vector3(length / 2, 0.30, 0), 0.28, 0.24, 9)
  const cut = addMesh(root, cylinderGeometry, palette.trunkLight, length / 2 + 0.015, 0.30, 0, 0.21, 0.025, 0.21)
  cut.rotation.z = -Math.PI / 2
  for (let i = 0; i < 3; i++) {
    const lx = -length * 0.28 + i * length * 0.28
    addMesh(root, leafGeometry, i % 2 ? palette.leafLime : palette.leaf,
      lx, 0.50, 0.07, 0.21, 0.11, 0.19)
  }
}

function addBush(scene: THREE.Scene, props: JungleProp[], x: number, z: number, size: number, variant: number) {
  const root = addProp(scene, props, 'bush', x, 0.06, z, 0.75)
  addMesh(root, leafGeometry, palette.leafDark, -size * 0.34, size * 0.36, 0, size * 0.53, size * 0.48, size * 0.50)
  addMesh(root, leafGeometry, variant % 2 ? palette.leafLime : palette.leaf, size * 0.29, size * 0.45, size * 0.08, size * 0.58, size * 0.54, size * 0.55)
  addMesh(root, leafGeometry, palette.leafLight, -size * 0.03, size * 0.66, -size * 0.24, size * 0.48, size * 0.49, size * 0.42)
  addMesh(root, pebbleGeometry, palette.mango, size * 0.19, size * 0.73, size * 0.46, size * 0.10, size * 0.10, size * 0.10)
}

function addMushroom(scene: THREE.Scene, props: JungleProp[], x: number, z: number, size: number, color: THREE.Material) {
  const root = addProp(scene, props, 'mushroom', x, 0.06, z, 0.42)
  addMesh(root, new THREE.CylinderGeometry(0.12, 0.17, 1, 7), palette.cream, 0, size * 0.35, 0, size, size * 0.70, size)
  const cap = addMesh(root, new THREE.ConeGeometry(0.56, 0.33, 9), color, 0, size * 0.78, 0, size, size, size)
  cap.rotation.y = 0.25
  for (const [px, pz] of [[-0.22, 0.12], [0.17, 0.19], [0.07, -0.20]]) {
    addMesh(root, flowerPetalGeometry, palette.cream, px * size, size * 0.82, pz * size, size * 0.047, size * 0.034, size * 0.047)
  }
}

function addFlower(scene: THREE.Scene, props: JungleProp[], x: number, z: number, height: number, variant: number) {
  const root = addProp(scene, props, 'flower', x, 0.07, z, 0.42)
  const stem = addMesh(root, new THREE.CylinderGeometry(0.025, 0.04, 1, 6), palette.grassDark, 0, height * 0.48, 0, 1, height * 0.96, 1)
  stem.rotation.z = variant % 2 ? 0.07 : -0.09
  addMesh(root, leafGeometry, palette.leaf, -0.13, height * 0.28, 0, 0.21, 0.065, 0.11).rotation.z = 0.48
  addMesh(root, leafGeometry, palette.leafDark, 0.13, height * 0.40, 0.02, 0.19, 0.065, 0.10).rotation.z = -0.42
  const petals = variant % 3 === 0 ? palette.coral : variant % 3 === 1 ? palette.pink : palette.mango
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2
    const petal = addMesh(root, flowerPetalGeometry, petals,
      Math.cos(angle) * 0.27, height + Math.sin(angle) * 0.27, 0.04,
      0.18, 0.26, 0.08)
    petal.rotation.z = angle - Math.PI / 2
  }
  addMesh(root, pebbleGeometry, palette.cream, 0, height, 0.13, 0.18, 0.18, 0.11)
}

function addPond(scene: THREE.Scene, props: JungleProp[]) {
  const x = 2.66
  const z = 1.47
  const root = addProp(scene, props, 'pond', x, 0.07, z, 1.65)
  addMesh(root, pebbleGeometry, palette.pondBank, 0, 0.05, 0, 1.83, 0.12, 1.36)
  addMesh(root, pebbleGeometry, palette.water, 0, 0.13, 0, 1.63, 0.10, 1.17)
  addMesh(root, pebbleGeometry, palette.waterLight, -0.49, 0.22, -0.27, 0.37, 0.025, 0.10)
  addMesh(root, pebbleGeometry, palette.waterLight, 0.38, 0.22, 0.28, 0.27, 0.021, 0.07)
  for (const [dx, dz, size, variant] of [
    [-0.54, 0.43, 0.32, 0], [0.48, -0.33, 0.36, 1], [0.70, 0.38, 0.27, 2],
  ] as const) {
    const lily = addProp(scene, props, 'lily', x + dx, 0.29, z + dz, 0.38)
    addMesh(lily, pebbleGeometry, variant % 2 ? palette.leafLime : palette.leafDark,
      0, 0.02, 0, size, 0.055, size * 0.88)
    if (variant === 1) {
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2
        addMesh(lily, flowerPetalGeometry, palette.pink,
          Math.cos(angle) * 0.10, 0.13, Math.sin(angle) * 0.10,
          0.10, 0.13, 0.07)
      }
      addMesh(lily, pebbleGeometry, palette.mango, 0, 0.19, 0, 0.07, 0.07, 0.07)
    }
  }
}

function addRuin(scene: THREE.Scene, props: JungleProp[]) {
  const root = addProp(scene, props, 'ruin', -0.34, 0.07, -2.13, 2.25)
  for (const side of [-1, 1]) {
    const x = side * 0.68
    addMesh(root, pebbleGeometry, palette.stoneDark, x, 0.16, 0, 0.39, 0.22, 0.36)
    addMesh(root, cylinderGeometry, palette.stone, x, 0.75, 0, 0.26, 1.13, 0.25)
    addMesh(root, pebbleGeometry, palette.stoneLight, x, 1.34, 0, 0.34, 0.16, 0.34)
    addMesh(root, leafGeometry, palette.leaf, x + side * 0.22, 0.44, 0.26, 0.26, 0.13, 0.23)
  }
  const lintel = addMesh(root, pebbleGeometry, palette.stone, 0, 1.52, 0, 1.13, 0.21, 0.35)
  lintel.rotation.z = -0.035
  addMesh(root, leafGeometry, palette.leafDark, -0.58, 1.70, -0.13, 0.43, 0.19, 0.29)
  addMesh(root, leafGeometry, palette.leafLight, 0.47, 1.72, -0.05, 0.36, 0.16, 0.24)
  segment(root, palette.grassDark, new THREE.Vector3(0.79, 1.61, 0.10), new THREE.Vector3(0.88, 0.84, 0.16), 0.028, 0.012, 5)
}

/** Build a broad, independently deformable cartoon jungle for a fixed orthographic camera. */
export function createJungle(scene: THREE.Scene): JungleProp[] {
  const props: JungleProp[] = []
  addIsland(scene, props)

  // Tall silhouettes surround the clearing while the main path stays reachable.
  addTree(scene, props, -5.17, -2.48, 2.22, 1.03, 0)
  addPalm(scene, props, -3.13, -4.73, 2.84, 1)
  addVineTree(scene, props, -0.74, -5.35, 3.10, 0)
  addTree(scene, props, 2.58, -4.74, 2.13, 0.94, 1)
  addPalm(scene, props, 5.22, -2.84, 2.76, 2)
  addVineTree(scene, props, 5.63, 0.23, 2.85, 1)
  addTree(scene, props, -5.57, 0.89, 1.88, 0.82, 3)

  addRuin(scene, props)
  addPond(scene, props)
  addLog(scene, props, -3.76, 2.61, 1.52, -0.38)
  addLog(scene, props, 5.18, 3.79, 1.25, 0.54)

  for (const [x, z, width, variant] of [
    [-5.39, 3.61, 0.73, 0], [-3.12, 4.62, 0.54, 1],
    [0.98, -4.74, 0.70, 2], [3.96, -3.56, 0.77, 3],
    [5.85, 2.49, 0.66, 4], [4.02, 4.91, 0.78, 5],
    [0.37, 4.84, 0.55, 6], [-5.76, -0.55, 0.61, 7],
  ] as const) addStone(scene, props, x, z, width, variant)

  for (const [x, z, size, variant] of [
    [-4.47, -0.59, 0.82, 0], [-3.53, -3.31, 0.78, 1],
    [1.10, -5.64, 0.72, 2], [4.15, -1.34, 0.81, 3],
    [5.73, 1.92, 0.75, 4], [1.72, 4.69, 0.80, 5],
    [-4.71, 4.64, 0.73, 6], [-2.15, 1.86, 0.71, 7],
  ] as const) addBush(scene, props, x, z, size, variant)

  for (const [x, z, size, variant] of [
    [-5.84, 1.91, 0.92, 0], [-3.89, -4.16, 0.79, 1],
    [-1.99, -3.73, 0.80, 2], [3.44, -5.00, 0.89, 3],
    [5.64, -0.88, 0.81, 4], [4.11, 3.83, 0.87, 5],
    [-1.01, 5.15, 0.91, 6], [-4.94, 2.18, 0.74, 7],
  ] as const) addFern(scene, props, x, z, size, variant)

  addMushroom(scene, props, -2.57, 3.05, 0.90, palette.coral)
  addMushroom(scene, props, 0.92, 3.24, 0.75, palette.mango)
  addMushroom(scene, props, 4.58, 2.88, 0.84, palette.pink)
  addMushroom(scene, props, -3.67, -1.66, 0.77, palette.mango)

  for (const [x, z, height, variant] of [
    [-3.35, 5.06, 0.86, 0], [-1.36, 4.69, 0.93, 1],
    [1.16, 5.56, 0.81, 2], [3.67, 5.02, 0.92, 3],
    [5.46, 0.88, 0.82, 4], [-5.04, 0.02, 0.83, 5],
    [-2.26, -4.64, 0.77, 6], [3.79, -2.74, 0.83, 7],
  ] as const) addFlower(scene, props, x, z, height, variant)

  return props
}
