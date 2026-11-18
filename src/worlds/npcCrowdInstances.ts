import * as THREE from 'three'

export type CrowdFigure = { npcId: number; appearanceSeed: number; x: number; y: number; z: number; heading: number }

/** Three shared draw calls for distant people, with a stable NPC ID per instance. */
export class NpcCrowdInstances {
  private readonly maxCount = 240
  private readonly body = new THREE.InstancedMesh(
    new THREE.BoxGeometry(.25, .27, .17), new THREE.MeshBasicMaterial({ color: 0xffffff }), this.maxCount)
  private readonly head = new THREE.InstancedMesh(
    new THREE.BoxGeometry(.18, .16, .18), new THREE.MeshBasicMaterial({ color: 0xffffff }), this.maxCount)
  private readonly legs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(.19, .16, .13), new THREE.MeshBasicMaterial({ color: 0xffffff }), this.maxCount)
  private readonly dummy = new THREE.Object3D()
  private readonly ids: number[] = []
  private readonly clothing = [0x49a7ce, 0xf1b43b, 0x75be79, 0xe37d73, 0x9a83c7,
    0xe2dc83, 0x5bbfb3, 0xd38d54, 0xb8c0cd, 0xc77ca8].map((value) => new THREE.Color(value))
  private readonly skin = [0xf3c9a2, 0xdba978, 0xb87b52, 0x8e563b,
    0xf0d6bc, 0xa96545].map((value) => new THREE.Color(value))
  private readonly pants = [0x253746, 0x4c3f48, 0x334a42, 0x6a5a48].map((value) => new THREE.Color(value))

  constructor(parent: THREE.Group) {
    for (const mesh of [this.body, this.head, this.legs]) {
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      parent.add(mesh)
    }
  }

  update(people: CrowdFigure[]): void {
    this.ids.length = 0
    const count = Math.min(this.maxCount, people.length)
    for (let index = 0; index < count; index++) {
      const person = people[index]
      this.ids.push(person.npcId)
      this.dummy.rotation.set(0, person.heading, 0)
      this.dummy.position.set(person.x, person.y + .26, person.z)
      this.dummy.updateMatrix()
      this.body.setMatrixAt(index, this.dummy.matrix)
      this.dummy.position.y = person.y + .49
      this.dummy.updateMatrix()
      this.head.setMatrixAt(index, this.dummy.matrix)
      this.dummy.position.y = person.y + .08
      this.dummy.updateMatrix()
      this.legs.setMatrixAt(index, this.dummy.matrix)
      const seed = person.appearanceSeed >>> 0
      this.body.setColorAt(index, this.clothing[seed % this.clothing.length])
      this.head.setColorAt(index, this.skin[(seed >>> 3) % this.skin.length])
      this.legs.setColorAt(index, this.pants[(seed >>> 7) % this.pants.length])
    }
    for (const mesh of [this.body, this.head, this.legs]) {
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  npcIdFor(hit: THREE.Intersection): number | null {
    if (hit.instanceId === undefined
      || (hit.object !== this.body && hit.object !== this.head && hit.object !== this.legs))
      return null
    return this.ids[hit.instanceId] ?? null
  }

  dispose(): void {
    for (const mesh of [this.body, this.head, this.legs]) {
      mesh.removeFromParent()
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
  }
}
