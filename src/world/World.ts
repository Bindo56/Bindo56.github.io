import * as THREE from 'three'
import { Environment } from './Environment.ts'
import type { Interactable } from './Interactable.ts'

/** Something solid, as its footprint on the ground plane. Anything above head height needs none. */
export type Collider =
  | { kind: 'circle'; x: number; z: number; radius: number }
  | { kind: 'box'; minX: number; maxX: number; minZ: number; maxZ: number }

/** Passes over the colliders per resolve: a push out of one can land in its neighbour. */
const RESOLVE_PASSES = 2

/** The scene and everything placed in it. */
export class World {
  readonly scene = new THREE.Scene()

  /**
   * Side length of the square play area, in metres. Room for the avenue of projects and the slide at its
   * end; more projects or experiences push the slide further out, so this may need to grow with them.
   */
  readonly size = 110
  readonly floorOffsetZ = -24

  readonly environment: Environment

  private readonly interactables: Interactable[] = []
  private readonly colliders: Collider[] = []

  constructor() {
    this.environment = new Environment(this.size)
    this.environment.group.position.z = this.floorOffsetZ
    this.environment.apply(this.scene)
  }

  add(...objects: THREE.Object3D[]): void {
    this.scene.add(...objects)
  }

  addInteractable(interactable: Interactable): void {
    this.interactables.push(interactable)
    this.scene.add(interactable.object)
  }

  addColliders(...colliders: readonly Collider[]): void {
    this.colliders.push(...colliders)
  }

  get allInteractables(): readonly Interactable[] {
    return this.interactables
  }

  /** The closest interactable whose reach includes the point, or null. */
  nearestInteractable(point: THREE.Vector3): Interactable | null {
    let nearest: Interactable | null = null
    let nearestDistance = Infinity

    for (const interactable of this.interactables) {
      const distance = interactable.distanceTo(point)
      if (distance <= interactable.radius && distance < nearestDistance) {
        nearest = interactable
        nearestDistance = distance
      }
    }

    return nearest
  }

  /** Pushes a body of `radius` standing at `point` out of every collider it overlaps. */
  resolveCollisions(point: { x: number; z: number }, radius: number): void {
    for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
      for (const collider of this.colliders) {
        if (collider.kind === 'circle') this.pushOutOfCircle(point, radius, collider)
        else this.pushOutOfBox(point, radius, collider)
      }
    }
  }

  /** Keeps a point inside the play area, one metre in from the edge. */
  clampToBounds(point: { x: number; z: number }): void {
    const limitX = this.size / 2 - 1
    const limitZ = this.size / 2 - 1
    point.x = THREE.MathUtils.clamp(point.x, -limitX, limitX)
    point.z = THREE.MathUtils.clamp(point.z, -limitZ + this.floorOffsetZ, limitZ + this.floorOffsetZ)
  }

  dispose(): void {
    for (const interactable of this.interactables) interactable.dispose()
    this.interactables.length = 0
    this.colliders.length = 0
    this.environment.dispose()
  }

  private pushOutOfCircle(point: { x: number; z: number }, radius: number, circle: Extract<Collider, { kind: 'circle' }>): void {
    const dx = point.x - circle.x
    const dz = point.z - circle.z
    const reach = radius + circle.radius
    const distance = Math.hypot(dx, dz)
    if (distance >= reach) return

    // Dead centre has no direction to push in; any will do.
    if (distance < 1e-6) {
      point.z = circle.z + reach
      return
    }

    point.x = circle.x + (dx / distance) * reach
    point.z = circle.z + (dz / distance) * reach
  }

  private pushOutOfBox(point: { x: number; z: number }, radius: number, box: Extract<Collider, { kind: 'box' }>): void {
    const nearestX = THREE.MathUtils.clamp(point.x, box.minX, box.maxX)
    const nearestZ = THREE.MathUtils.clamp(point.z, box.minZ, box.maxZ)
    const dx = point.x - nearestX
    const dz = point.z - nearestZ

    if (dx !== 0 || dz !== 0) {
      const distance = Math.hypot(dx, dz)
      if (distance >= radius) return
      point.x = nearestX + (dx / distance) * radius
      point.z = nearestZ + (dz / distance) * radius
      return
    }

    // Centre inside the box: out through the nearest side.
    const exits = [
      { gap: point.x - box.minX, apply: () => (point.x = box.minX - radius) },
      { gap: box.maxX - point.x, apply: () => (point.x = box.maxX + radius) },
      { gap: point.z - box.minZ, apply: () => (point.z = box.minZ - radius) },
      { gap: box.maxZ - point.z, apply: () => (point.z = box.maxZ + radius) },
    ]
    exits.reduce((best, exit) => (exit.gap < best.gap ? exit : best)).apply()
  }
}
