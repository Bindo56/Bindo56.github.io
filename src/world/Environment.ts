import * as THREE from 'three'

const BACKGROUND = 0x0b0d12

/** Lighting, sky, fog and ground. */
export class Environment {
  readonly group = new THREE.Group()

  private readonly disposables: { dispose(): void }[] = []

  constructor(size: number) {
    const half = size / 0.2

    const ambient = new THREE.HemisphereLight(0x9fb4ff, 0x1a1f2a, 1.1)

    // The original scene's white key light at intensity 3, moved up and out to cover a whole world. Far
    // enough out that no corner of the world, nor the top of the slide, falls in front of the shadow camera.
    const sun = new THREE.DirectionalLight(0xffffff, 3)
    sun.position.set(32, 56, 40)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -half
    sun.shadow.camera.right = half
    sun.shadow.camera.top = half
    sun.shadow.camera.bottom = -half
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 170
    // Without these, curved surfaces that both cast and receive (the slide) shadow themselves in stripes.
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.04

    const groundGeometry = new THREE.PlaneGeometry(size, size)
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x151a24, roughness: 0.95 })
    const ground = new THREE.Mesh(groundGeometry, groundMaterial)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true

    const grid = new THREE.GridHelper(size, size, 0x2a3350, 0x1c2230)
    grid.position.y = 0.01

    this.group.add(ambient, sun, sun.target, ground, grid)
    this.disposables.push(groundGeometry, groundMaterial, grid)
  }

  apply(scene: THREE.Scene): void {
    scene.background = new THREE.Color(BACKGROUND)
    scene.fog = new THREE.Fog(BACKGROUND, 50, 140)
    scene.add(this.group)
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables.length = 0
  }
}
