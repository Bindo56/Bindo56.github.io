import * as THREE from 'three'
import type { Input } from '../core/Input.ts'
import type { Interactable } from '../world/Interactable.ts'
import type { World } from '../world/World.ts'
import type { Player } from './Player.ts'

/** How quickly the player turns to face where they are going. Higher is snappier. */
const TURN_SHARPNESS = 14

/** Turns from one heading toward another the short way round. Frame-rate independent. */
function turnToward(current: number, target: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + delta * (1 - Math.exp(-TURN_SHARPNESS * dt))
}

/** Moves the player from keyboard input and handles interacting with whatever is in reach. */
export class PlayerController {
  /** Switched off while a popup or menu has the keyboard, or the slide has the player. */
  enabled = true

  private readonly player: Player
  private readonly input: Input
  private readonly world: World
  private readonly direction = new THREE.Vector3()
  private focused: Interactable | null = null

  constructor(player: Player, input: Input, world: World) {
    this.player = player
    this.input = input
    this.world = world
  }

  /** The interactable in reach right now, if any. */
  get focus(): Interactable | null {
    return this.focused
  }

  update(dt: number): void {
    if (this.enabled) this.move(dt)
    this.updateFocus()

    if (this.enabled && this.focused && this.input.consume('KeyE')) this.focused.interact()
  }

  private move(dt: number): void {
    const axis = this.input.axis()
    this.direction.set(axis.x, 0, axis.y)
    if (this.direction.lengthSq() === 0) return

    // Normalised, so moving diagonally is not faster than moving straight.
    this.direction.normalize()
    this.player.position.addScaledVector(this.direction, this.player.speed * dt)
    this.world.resolveCollisions(this.player.position, this.player.radius)
    this.world.clampToBounds(this.player.position)

    const heading = Math.atan2(this.direction.x, this.direction.z)
    this.player.object.rotation.y = turnToward(this.player.object.rotation.y, heading, dt)
  }

  private updateFocus(): void {
    const next = this.world.nearestInteractable(this.player.position)
    if (next === this.focused) return

    this.focused?.setFocused(false)
    next?.setFocused(true)
    this.focused = next
  }
}
