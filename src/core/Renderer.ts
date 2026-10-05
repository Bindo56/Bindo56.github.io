import * as THREE from 'three'

/** Where the camera sits relative to what it follows: up and behind. */
const FOLLOW_OFFSET = new THREE.Vector3(0, 7, 10)

/** The camera aims this far above the target's feet. */
const LOOK_HEIGHT = 1

/** How quickly the camera catches up. Higher is snappier. */
const FOLLOW_SHARPNESS = 6

/** The WebGL renderer and the camera, sized to the window. */
export class Renderer {
  readonly webgl: THREE.WebGLRenderer
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000)

  private readonly desiredPosition = new THREE.Vector3()
  private readonly desiredLookAt = new THREE.Vector3()
  private readonly lookAt = new THREE.Vector3()

  constructor(container: HTMLElement) {
    this.webgl = new THREE.WebGLRenderer({ antialias: true })
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.webgl.shadowMap.enabled = true

    // First child, so the UI layer added after it draws on top.
    container.prepend(this.webgl.domElement)

    this.resize()
    window.addEventListener('resize', this.resize)
  }

  /** Places the camera immediately, so it does not sweep in from the origin on the first frame. */
  snapTo(target: THREE.Vector3): void {
    this.camera.position.copy(target).add(FOLLOW_OFFSET)
    this.lookAt.set(target.x, target.y + LOOK_HEIGHT, target.z)
    this.camera.lookAt(this.lookAt)
  }

  /** Eases the camera toward its spot behind the target. Frame-rate independent. */
  follow(target: THREE.Vector3, dt: number): void {
    const t = 1 - Math.exp(-FOLLOW_SHARPNESS * dt)

    this.desiredPosition.copy(target).add(FOLLOW_OFFSET)
    this.camera.position.lerp(this.desiredPosition, t)

    this.desiredLookAt.set(target.x, target.y + LOOK_HEIGHT, target.z)
    this.lookAt.lerp(this.desiredLookAt, t)
    this.camera.lookAt(this.lookAt)
  }

  render(scene: THREE.Scene): void {
    this.webgl.render(scene, this.camera)
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize)
    this.webgl.setAnimationLoop(null)
    this.webgl.dispose()
    this.webgl.domElement.remove()
  }

  private readonly resize = (): void => {
    const width = window.innerWidth
    const height = window.innerHeight

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.webgl.setSize(width, height)
  }
}
