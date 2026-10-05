import * as THREE from 'three'

/** The player character: its model and its stats. Movement lives in PlayerController. */
export class Player {
  readonly object = new THREE.Group()

  /** Metres per second. */
  readonly speed = 6

  /** Footprint for collisions, in metres. */
  readonly radius = 0.4

  /** The visible body. Pivots at the feet, so posture never moves the player or changes their heading. */
  private readonly model = new THREE.Group()
  private readonly disposables: { dispose(): void }[] = []

  constructor() {
    // Red, like the original cube.
    const bodyGeometry = new THREE.CapsuleGeometry(0.4, 0.8, 4, 16)
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.5 })
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    body.position.y = 0.8
    body.castShadow = true

    // A visor on the front, so you can tell which way the player is facing.
    const visorGeometry = new THREE.BoxGeometry(0.5, 0.14, 0.12)
    const visorMaterial = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.2 })
    const visor = new THREE.Mesh(visorGeometry, visorMaterial)
    visor.position.set(0, 1.15, 0.36)

    this.model.add(body, visor)
    this.object.add(this.model)
    this.disposables.push(bodyGeometry, bodyMaterial, visorGeometry, visorMaterial)
  }

  get position(): THREE.Vector3 {
    return this.object.position
  }

  /** Tilts the body about the feet: negative leans back, positive forward, 0 stands upright. */
  setLean(radians: number): void {
    this.model.rotation.x = radians
  }

  dispose(): void {
    this.object.removeFromParent()
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables.length = 0
  }
}
