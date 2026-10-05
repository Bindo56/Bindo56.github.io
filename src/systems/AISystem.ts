import * as THREE from 'three'
import type { World } from '../world/World.ts'
import type { AnimationSystem } from './AnimationSystem.ts'
import type { Damageable } from './CombatSystem.ts'

export type SentinelState = 'patrol' | 'alert' | 'offline'

const HOVER_HEIGHT = 1.6
const OFFLINE_HEIGHT = 0.45

const EYE_PATROL = 0x4f8cff
const EYE_ALERT = 0xff3b3b
const EYE_OFFLINE = 0x2a3040

/** Metres per second along the patrol circle. */
const PATROL_SPEED = 1.6
const TURN_SHARPNESS = 8

function turnToward(current: number, target: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + delta * (1 - Math.exp(-TURN_SHARPNESS * dt))
}

/** A hovering drone that circles its post, and stops to watch the player when they come close. */
export class Sentinel implements Damageable {
  readonly object = new THREE.Group()

  /** Everything that hovers and tilts. Separate from `object`, so AI movement and the bob never fight. */
  readonly body = new THREE.Group()
  readonly rotor = new THREE.Group()

  readonly maxHealth = 100
  health = 100

  readonly home: THREE.Vector3
  readonly patrolRadius: number

  /** Position around the patrol circle, in radians. */
  angle = Math.random() * Math.PI * 2

  private currentState: SentinelState = 'patrol'
  private readonly eyeMaterial: THREE.MeshStandardMaterial
  private readonly defeatedHook: (sentinel: Sentinel) => void
  private readonly disposables: { dispose(): void }[] = []

  constructor(home: { x: number; z: number }, patrolRadius: number, onDefeated: (sentinel: Sentinel) => void) {
    this.home = new THREE.Vector3(home.x, 0, home.z)
    this.patrolRadius = patrolRadius
    this.defeatedHook = onDefeated

    const shellGeometry = new THREE.SphereGeometry(0.45, 24, 16)
    const shellMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4255, metalness: 0.6, roughness: 0.35 })
    const shell = new THREE.Mesh(shellGeometry, shellMaterial)
    shell.castShadow = true

    const eyeGeometry = new THREE.SphereGeometry(0.12, 16, 12)
    this.eyeMaterial = new THREE.MeshStandardMaterial({ color: EYE_PATROL, emissive: EYE_PATROL, emissiveIntensity: 1.5 })
    const eye = new THREE.Mesh(eyeGeometry, this.eyeMaterial)
    eye.position.set(0, 0.05, 0.4)

    const bladeGeometry = new THREE.BoxGeometry(1.1, 0.03, 0.1)
    const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0x8a93a8, metalness: 0.8, roughness: 0.3 })
    const bladeA = new THREE.Mesh(bladeGeometry, bladeMaterial)
    const bladeB = new THREE.Mesh(bladeGeometry, bladeMaterial)
    bladeB.rotation.y = Math.PI / 2
    this.rotor.add(bladeA, bladeB)
    this.rotor.position.y = 0.5

    this.body.add(shell, eye, this.rotor)
    this.body.position.y = HOVER_HEIGHT
    this.object.add(this.body)

    this.disposables.push(shellGeometry, shellMaterial, eyeGeometry, this.eyeMaterial, bladeGeometry, bladeMaterial)
    this.placeOnPatrol()
  }

  get state(): SentinelState {
    return this.currentState
  }

  setState(next: Exclude<SentinelState, 'offline'>): void {
    if (this.currentState === next || this.currentState === 'offline') return
    this.currentState = next
    this.setEye(next === 'alert' ? EYE_ALERT : EYE_PATROL)
  }

  /** Moves the sentinel to its current angle on the patrol circle. */
  placeOnPatrol(): void {
    this.object.position.set(
      this.home.x + Math.sin(this.angle) * this.patrolRadius,
      0,
      this.home.z + Math.cos(this.angle) * this.patrolRadius,
    )
  }

  onDefeated(): void {
    this.currentState = 'offline'
    this.setEye(EYE_OFFLINE)
    this.eyeMaterial.emissiveIntensity = 0

    // Powered down: drops to the ground and lists to one side.
    this.body.position.y = OFFLINE_HEIGHT
    this.body.rotation.z = 0.35

    this.defeatedHook(this)
  }

  dispose(): void {
    this.object.removeFromParent()
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables.length = 0
  }

  private setEye(color: number): void {
    this.eyeMaterial.color.setHex(color)
    this.eyeMaterial.emissive.setHex(color)
  }
}

/** Spawns and drives the world's non-player agents. */
export class AISystem {
  /** Distance at which a sentinel stops patrolling and watches the player. */
  readonly alertRadius = 7

  private readonly world: World
  private readonly animation: AnimationSystem
  private readonly target: THREE.Object3D
  private readonly sentinels: Sentinel[] = []

  constructor(world: World, animation: AnimationSystem, target: THREE.Object3D) {
    this.world = world
    this.animation = animation
    this.target = target
  }

  get all(): readonly Sentinel[] {
    return this.sentinels
  }

  spawn(post: { x: number; z: number }, patrolRadius: number, onOffline: (sentinel: Sentinel) => void): Sentinel {
    const sentinel = new Sentinel(post, patrolRadius, (defeated) => {
      this.animation.stop(defeated.rotor)
      this.animation.stop(defeated.body)
      onOffline(defeated)
    })

    this.world.add(sentinel.object)
    this.animation.spin(sentinel.rotor, 10)
    this.animation.bob(sentinel.body, 0.12, 0.8)
    this.sentinels.push(sentinel)

    return sentinel
  }

  update(dt: number): void {
    const target = this.target.position

    for (const sentinel of this.sentinels) {
      if (sentinel.state === 'offline') continue

      const position = sentinel.object.position
      const dx = target.x - position.x
      const dz = target.z - position.z
      const alert = Math.hypot(dx, dz) <= this.alertRadius

      sentinel.setState(alert ? 'alert' : 'patrol')

      if (alert) {
        // Holds position and watches. The angle does not advance, so patrol resumes from this spot.
        sentinel.object.rotation.y = turnToward(sentinel.object.rotation.y, Math.atan2(dx, dz), dt)
        continue
      }

      sentinel.angle += (PATROL_SPEED / sentinel.patrolRadius) * dt
      sentinel.placeOnPatrol()

      // Tangent to the circle, i.e. the direction of travel.
      const heading = Math.atan2(Math.cos(sentinel.angle), -Math.sin(sentinel.angle))
      sentinel.object.rotation.y = turnToward(sentinel.object.rotation.y, heading, dt)
    }
  }

  dispose(): void {
    for (const sentinel of this.sentinels) sentinel.dispose()
    this.sentinels.length = 0
  }
}
