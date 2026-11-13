import * as THREE from 'three'

export interface InteractableOptions {
  id: string
  label: string
  /** What the HUD offers, after "[E]". Defaults to "Inspect <label>". */
  prompt?: string
  /** On the ground plane, in metres. */
  position: { x: number; z: number }
  /** How close the player has to be, in metres. */
  radius?: number
  onInteract: (interactable: Interactable) => void
}

/**
 * A spot in the world the player can walk up to and press E on. On its own it has no body - subclasses
 * such as ProjectPillar add one - so it also works as an invisible trigger, like the foot of a ladder.
 */
export class Interactable {
  readonly id: string
  readonly label: string
  readonly prompt: string
  readonly radius: number
  readonly object = new THREE.Group()

  protected readonly disposables: { dispose(): void }[] = []

  private readonly onInteract: (interactable: Interactable) => void
  private focused = false

  constructor(options: InteractableOptions) {
    this.id = options.id
    this.label = options.label
    this.prompt = options.prompt ?? `Inspect ${options.label}`
    this.radius = options.radius ?? 2.5
    this.onInteract = options.onInteract
    this.object.position.set(options.position.x, 0, options.position.z)
  }

  get isFocused(): boolean {
    return this.focused
  }

  /** Set while it is the thing the player would interact with. */
  setFocused(focused: boolean): void {
    if (this.focused === focused) return
    this.focused = focused
    this.onFocusChanged(focused)
  }

  /** Flat distance - height has no bearing on whether the player is standing next to it. */
  distanceTo(point: THREE.Vector3): number {
    return Math.hypot(point.x - this.object.position.x, point.z - this.object.position.z)
  }

  interact(): void {
    this.onInteract(this)
  }

  dispose(): void {
    this.object.removeFromParent()
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables.length = 0
  }

  /** Override to show focus, e.g. by glowing brighter. */
  protected onFocusChanged(_focused: boolean): void {}
}
