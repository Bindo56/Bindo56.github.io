import * as THREE from 'three'
import { loadProofCrowdAssets } from './npcProofCharacter'

export type CrowdFigure = { npcId: number; appearanceSeed: number; x: number; y: number; z: number; heading: number }

/** Instances of the supplied 100 People FBX variants; every instance keeps its own NPC ID. */
export class NpcCrowdInstances {
  private readonly capacity = 240
  private readonly meshes: THREE.InstancedMesh[] = []
  private readonly ids: number[][] = []
  private readonly variantByMesh = new Map<THREE.Object3D, number>()
  private readonly dummy = new THREE.Object3D()
  private latest: CrowdFigure[] = []
  private disposed = false

  constructor(private readonly parent: THREE.Group, private readonly onChange: () => void) {
    void loadProofCrowdAssets().then(({ geometries, material }) => {
      if (this.disposed) return
      geometries.forEach((geometry, index) => {
        const mesh = new THREE.InstancedMesh(geometry, material, this.capacity)
        mesh.name = `100 People FBX variant ${index}`
        mesh.count = 0
        mesh.frustumCulled = false
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        this.parent.add(mesh)
        this.meshes.push(mesh)
        this.ids.push([])
        this.variantByMesh.set(mesh, index)
      })
      this.update(this.latest)
      this.onChange()
    }).catch((error) => console.error('Could not prepare 100 People FBX crowd:', error))
  }

  update(people: CrowdFigure[]): void {
    this.latest = people
    if (!this.meshes.length) return
    for (const ids of this.ids) ids.length = 0
    for (const person of people) {
      const variant = person.npcId === 37669 ? 0 : person.appearanceSeed
      const index = ((Math.floor(variant) % this.meshes.length) + this.meshes.length) % this.meshes.length
      const slot = this.ids[index].length
      if (slot >= this.capacity) continue
      this.ids[index].push(person.npcId)
      this.dummy.position.set(person.x, person.y, person.z)
      this.dummy.rotation.set(0, person.heading, 0)
      this.dummy.updateMatrix()
      this.meshes[index].setMatrixAt(slot, this.dummy.matrix)
    }
    this.meshes.forEach((mesh, index) => {
      mesh.count = this.ids[index].length
      if (mesh.count) mesh.instanceMatrix.needsUpdate = true
    })
  }

  npcIdFor(hit: THREE.Intersection): number | null {
    if (hit.instanceId === undefined) return null
    const variant = this.variantByMesh.get(hit.object)
    return variant === undefined ? null : this.ids[variant][hit.instanceId] ?? null
  }

  dispose(): void {
    this.disposed = true
    for (const mesh of this.meshes) mesh.removeFromParent()
    this.meshes.length = 0
    this.ids.length = 0
    this.variantByMesh.clear()
    this.latest = []
    // Cached FBX geometry and palette can be reused by the next crowd renderer.
  }
}
