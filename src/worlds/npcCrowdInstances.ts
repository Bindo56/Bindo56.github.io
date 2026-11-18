import * as THREE from 'three'
import { loadProofCrowdAssets } from './npcProofCharacter'

export type CrowdFigure = { npcId: number; appearanceSeed: number; x: number; y: number; z: number; heading: number; walking: boolean }

/** Instances of the supplied 100 People FBX variants; every instance keeps its own NPC ID. */
export class NpcCrowdInstances {
  private readonly capacity = 400
  private readonly meshes: THREE.InstancedMesh[] = []
  private readonly ids: number[][] = []
  private readonly variantByMesh = new Map<THREE.Object3D, number>()
  private readonly dummy = new THREE.Object3D()
  private morphDriver: THREE.Mesh | null = null
  private walkDuration = 2 / 3
  private animationSeconds = 0
  private latest: CrowdFigure[] = []
  private disposed = false

  constructor(private readonly parent: THREE.Group, private readonly onChange: () => void) {
    void loadProofCrowdAssets().then(({ geometries, material, walkDuration }) => {
      if (this.disposed) return
      this.walkDuration = walkDuration
      this.morphDriver = new THREE.Mesh(geometries[0], material)
      geometries.forEach((geometry, index) => {
        const mesh = new THREE.InstancedMesh(geometry, material, this.capacity)
        mesh.name = `100 People FBX variant ${index}`
        mesh.count = 0
        mesh.visible = false
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

  update(people: CrowdFigure[], dt = 0): void {
    this.latest = people
    if (!this.meshes.length || !this.morphDriver) return
    this.animationSeconds += Math.max(0, Math.min(dt, .25))
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
      const mesh = this.meshes[index]
      mesh.setMatrixAt(slot, this.dummy.matrix)
      const influences = this.morphDriver.morphTargetInfluences!
      influences.fill(0)
      if (person.walking) {
        const phase = ((this.animationSeconds / this.walkDuration + person.npcId * .173) % 1 + 1) % 1 * 4
        const frame = Math.floor(phase)
        influences[frame] = 1 - (phase - frame)
        influences[(frame + 1) % 4] = phase - frame
      }
      // The morph texture is allocated using count; reserve the full capacity once.
      if (!mesh.morphTexture) mesh.count = this.capacity
      mesh.setMorphAt(slot, this.morphDriver)
    }
    this.meshes.forEach((mesh, index) => {
      mesh.count = this.ids[index].length
      mesh.visible = mesh.count > 0
      if (mesh.count) {
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.morphTexture) mesh.morphTexture.needsUpdate = true
      }
    })
  }

  npcIdFor(hit: THREE.Intersection): number | null {
    if (hit.instanceId === undefined) return null
    const variant = this.variantByMesh.get(hit.object)
    return variant === undefined ? null : this.ids[variant][hit.instanceId] ?? null
  }

  dispose(): void {
    this.disposed = true
    for (const mesh of this.meshes) { mesh.removeFromParent(); mesh.dispose() }
    this.meshes.length = 0
    this.ids.length = 0
    this.variantByMesh.clear()
    this.morphDriver = null
    this.latest = []
    // Cached FBX geometry and palette can be reused by the next crowd renderer.
  }
}
