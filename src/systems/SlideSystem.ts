import * as THREE from 'three'
import type { Player } from '../player/Player.ts'
import type { ExperienceSlide } from '../world/ExperienceSlide.ts'

type Phase = 'idle' | 'climbing' | 'sliding' | 'stopped' | 'dismounting'
type Listener<T> = (value: T) => void

/** Metres per second up the ladder, and across the platform to the launch. */
const CLIMB_SPEED = 3.5
/** Speed down the slide: it picks up from the first value toward the second. */
const SLIDE_START_SPEED = 0.8
const SLIDE_TOP_SPEED = 4.5
const SLIDE_ACCELERATION = 2.2
/** Deceleration into each experience's stop, metres per second squared. Lower brakes earlier and gentler. */
const BRAKING = 1.4
/** The slowest it creeps in on a stop, so it always arrives. */
const CREEP_SPEED = 0.35
/** Walking pace off the end of the slide, standing up on the way. */
const DISMOUNT_SPEED = 1.8
/** Sitting on the slide: leaning back from the slide's surface, in radians. */
const SIT_LEAN = 0.95

/**
 * The ride: up the ladder, down the zig-zag with a stop at every experience, and off the end onto the
 * floor, where the player carries on from. At a stop it waits until `resume` is called. The player's
 * controls are the game's to switch off while `isRiding` is true.
 */
export class SlideSystem {
  private readonly player: Player
  private readonly slide: ExperienceSlide

  private phase: Phase = 'idle'
  private leg = 0
  private distance = 0
  private speed = 0
  private nextStop = 0

  private readonly stopListeners = new Set<Listener<number>>()

  private readonly tangent = new THREE.Vector3()
  private readonly dismountFrom = new THREE.Vector3()
  /** The body's lean as last set on the slide - where standing up starts from. */
  private lean = 0

  constructor(player: Player, slide: ExperienceSlide) {
    this.player = player
    this.slide = slide
  }

  get isRiding(): boolean {
    return this.phase !== 'idle'
  }

  /** The ride has come to rest at experience `index`. Returns a function that removes the listener. */
  onStop(listener: Listener<number>): () => void {
    this.stopListeners.add(listener)
    return () => this.stopListeners.delete(listener)
  }

  /** Starts the climb from the foot of the ladder. Does nothing mid-ride. */
  begin(): void {
    if (this.phase !== 'idle') return

    this.phase = 'climbing'
    this.leg = 0
    this.nextStop = 0
    this.player.position.copy(this.slide.climbRoute[0])
    this.player.setLean(0)
  }

  /** Sets off again from a stop. */
  resume(): void {
    if (this.phase !== 'stopped') return
    this.phase = 'sliding'
    this.speed = SLIDE_START_SPEED
  }

  update(dt: number): void {
    switch (this.phase) {
      case 'climbing':
        this.climb(dt)
        break
      case 'sliding':
        this.ride(dt)
        break
      case 'dismounting':
        this.dismount(dt)
        break
      case 'stopped':
      case 'idle':
        break
    }
  }

  dispose(): void {
    this.stopListeners.clear()
  }

  private climb(dt: number): void {
    const route = this.slide.climbRoute
    let step = CLIMB_SPEED * dt

    // Straight from waypoint to waypoint; a long frame can finish one leg and carry on into the next.
    while (step > 0 && this.leg < route.length - 1) {
      const target = route[this.leg + 1]
      const remaining = this.player.position.distanceTo(target)

      this.face(target.x - this.player.position.x, target.z - this.player.position.z)

      if (remaining <= step) {
        this.player.position.copy(target)
        step -= remaining
        this.leg++
      } else {
        this.player.position.lerp(target, step / remaining)
        step = 0
      }
    }

    if (this.leg >= route.length - 1) {
      this.phase = 'sliding'
      this.distance = 0
      this.speed = SLIDE_START_SPEED
      this.placeOnSlide()
    }
  }

  private ride(dt: number): void {
    const stops = this.slide.stops
    const braking = this.nextStop < stops.length
    const target = braking ? stops[this.nextStop] : this.slide.length
    const remaining = Math.max(0, target - this.distance)

    this.speed = Math.min(SLIDE_TOP_SPEED, this.speed + SLIDE_ACCELERATION * dt)
    // Never faster than it could still brake from in the distance left - so it glides to a halt on the mark.
    if (braking) this.speed = Math.max(CREEP_SPEED, Math.min(this.speed, Math.sqrt(2 * BRAKING * remaining)))

    const step = this.speed * dt
    if (step < remaining) {
      this.distance += step
      this.placeOnSlide()
      return
    }

    this.distance = target
    this.placeOnSlide()

    if (braking) {
      this.phase = 'stopped'
      this.speed = 0
      const index = this.nextStop++
      for (const listener of this.stopListeners) listener(index)
    } else {
      this.phase = 'dismounting'
      this.dismountFrom.copy(this.player.position)
    }
  }

  /** Off the end and onto the floor, standing up over the same few steps. Then the player is theirs again. */
  private dismount(dt: number): void {
    const to = this.slide.dismountPoint
    const total = this.dismountFrom.distanceTo(to)
    const remaining = this.player.position.distanceTo(to)
    const step = DISMOUNT_SPEED * dt

    if (step >= remaining || total < 1e-6) {
      this.player.position.copy(to)
      this.player.setLean(0)
      this.phase = 'idle'
      return
    }

    this.player.position.lerp(to, step / remaining)
    this.face(to.x - this.player.position.x, to.z - this.player.position.z)

    // Upright by two-thirds of the way.
    const progress = 1 - (remaining - step) / total
    this.player.setLean(this.lean * (1 - Math.min(1, progress * 1.5)))
  }

  private placeOnSlide(): void {
    this.slide.pointAt(this.distance, this.player.position)
    this.slide.tangentAt(this.distance, this.tangent)
    this.face(this.tangent.x, this.tangent.z)

    // Sat back against the slope: the steeper the drop ahead, the more the body tips forward with it.
    const slope = Math.asin(THREE.MathUtils.clamp(-this.tangent.y, -1, 1))
    this.lean = -SIT_LEAN + slope
    this.player.setLean(this.lean)
  }

  private face(x: number, z: number): void {
    if (x * x + z * z > 1e-6) this.player.object.rotation.y = Math.atan2(x, z)
  }
}
