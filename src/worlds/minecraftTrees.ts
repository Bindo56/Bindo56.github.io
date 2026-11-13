import * as THREE from 'three'

// World x/z, species silhouette, and crown scale. Positions come from NYC Parks tree points
// or from park/woodland polygons where the point inventory has no coverage.
export type MinecraftTree = [number, number, number, number]

const block = new THREE.BoxGeometry(1, 1, 1)
const barkMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true })
const leafMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true })
type CrownBlock = [number, number, number, number, number, number, number]

// Each silhouette uses axis-aligned leaf blocks [dx, dy, dz, width, height, depth, colour].
// 0 London plane, 1 honeylocust, 2 Callery pear, 3 oak, 4 ginkgo, 5 other broadleaf.
const crowns: CrownBlock[][] = [
  [[-1.05, .15, 0, 2.3, 1.35, 2.5, 0x4d8245], [1.0, .35, -.3, 2.4, 1.4, 2.6, 0x579149],
    [0, 1.25, .35, 3.1, 1.65, 2.8, 0x619b50], [0, 2.15, 0, 1.9, .85, 1.9, 0x70a354]],
  [[-.95, .1, 0, 1.8, .7, 1.8, 0x628f49], [.95, .45, .3, 1.9, .7, 1.8, 0x74a652],
    [0, 1.15, -.3, 2.6, .75, 2.2, 0x80aa57], [.25, 1.85, .2, 1.65, .65, 1.5, 0x90b35b]],
  [[0, -.1, 0, 1.4, 1.3, 1.4, 0x568a45], [0, .95, 0, 2.0, 1.65, 1.9, 0x68a252],
    [0, 2.05, 0, 1.45, 1.15, 1.45, 0x78ad5d], [0, 2.75, 0, .85, .65, .85, 0x86b666]],
  [[-1, .1, 0, 2.1, 1.2, 2.1, 0x416f39], [1, .1, .15, 2.1, 1.2, 2.1, 0x4b7f40],
    [0, 1.2, 0, 3.0, 1.55, 2.8, 0x578a45], [0, 2.15, 0, 2, .85, 1.95, 0x64964d]],
  [[-.85, .25, 0, 1.65, .95, 1.7, 0x749744], [.85, .25, 0, 1.65, .95, 1.7, 0x85a34b],
    [0, 1.15, 0, 2.4, 1.2, 2.25, 0x93ae51], [0, 2.05, 0, 1.15, .7, 1.15, 0xa3b85c]],
  [[-.7, .1, 0, 1.85, 1.1, 1.8, 0x4c8344], [.7, .2, .15, 1.9, 1.1, 1.8, 0x5c944b],
    [0, 1.15, -.1, 2.5, 1.45, 2.35, 0x6ca356], [0, 2, 0, 1.35, .75, 1.35, 0x79ad60]],
]
const dummy = new THREE.Object3D()

export function buildMinecraftTrees(data: MinecraftTree[], crop?: { x: number; z: number; radius: number }): THREE.Group {
  const visible = crop ? data.filter(([x, z]) => Math.abs(x - crop.x) < crop.radius && Math.abs(z - crop.z) < crop.radius) : data
  const group = new THREE.Group()
  group.name = `${visible.length} Minecraft trees`
  if (!visible.length) return group
  const trunks = new THREE.InstancedMesh(block, barkMaterial, visible.length)
  const leaves = new THREE.InstancedMesh(block, leafMaterial,
    visible.reduce((sum, tree) => sum + crowns[tree[2] % crowns.length].length, 0))
  trunks.name = 'Block tree trunks'
  leaves.name = 'Species crowns'
  let leafIndex = 0
  visible.forEach(([x, z, kind, size], index) => {
    const trunkHeight = (kind === 2 ? 2.55 : kind === 1 ? 2.8 : 2.4) * size + .5
    const trunkWidth = (kind === 0 || kind === 3 ? .48 : .34) * size
    dummy.position.set(x, trunkHeight / 2, z)
    dummy.scale.set(trunkWidth, trunkHeight, trunkWidth)
    dummy.updateMatrix()
    trunks.setMatrixAt(index, dummy.matrix)
    trunks.setColorAt(index, new THREE.Color(kind === 0 ? 0x88745c : kind === 4 ? 0x756d58 : 0x655341))
    const variation = .92 + (((Math.floor(x * 13 + z * 7) >>> 0) % 17) / 100)
    for (const [dx, dy, dz, w, h, d, color] of crowns[kind % crowns.length]) {
      dummy.position.set(x + dx * size, trunkHeight + (dy + .2) * size, z + dz * size)
      dummy.scale.set(w * size, h * size, d * size)
      dummy.updateMatrix()
      leaves.setMatrixAt(leafIndex, dummy.matrix)
      leaves.setColorAt(leafIndex, new THREE.Color(color).multiplyScalar(variation))
      leafIndex++
    }
  })
  trunks.instanceMatrix.needsUpdate = true
  leaves.instanceMatrix.needsUpdate = true
  trunks.instanceColor!.needsUpdate = true
  leaves.instanceColor!.needsUpdate = true
  trunks.computeBoundingSphere()
  leaves.computeBoundingSphere()
  group.add(trunks, leaves)
  return group
}

export function disposeMinecraftTrees(group: THREE.Group) {
  group.traverse((item) => { if (item instanceof THREE.InstancedMesh) item.dispose() })
}
