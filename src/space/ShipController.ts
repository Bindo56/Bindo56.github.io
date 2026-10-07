import * as THREE from 'three'
import {
  normalizeSpacePosition,
  offsetSpacePosition,
  type SpacePosition,
} from './SpacePosition.ts'

/** Analog actions in [-1, 1], supplied by whichever input context owns flight. */
export interface ShipActions {
  thrust: number
  strafe: number
  lift: number
  yaw: number
  pitch: number
  roll: number
  boost: boolean
  brake: boolean
}

export const IDLE_SHIP_ACTIONS: Readonly<ShipActions> = {
  thrust: 0,
  strafe: 0,
  lift: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  boost: false,
  brake: false,
}

// An arcade ship needs a decisive turn even when the viewport steer axis is
// only partly deflected. Rates are radians per second at full input.
const TURN_RATE = 2.4
const ROLL_RATE = 2.75
const CRUISE_ACCELERATION = 42
const BOOST_ACCELERATION = 125
const CRUISE_MAX_SPEED = 84
const BOOST_MAX_SPEED = 195
const DRAG = 1.2
const BOOST_DRAG = 0.9
const BRAKE_DRAG = 7.5

/** Flight math is independent of the renderer and advances at a fixed timestep. */
export class ShipController {
  position: SpacePosition
  readonly orientation = new THREE.Quaternion()
  readonly velocity = new THREE.Vector3()

  private readonly turn = new THREE.Quaternion()
  private readonly acceleration = new THREE.Vector3()

  constructor(start: SpacePosition = { sector: [0, 0, 0], local: [0, 0, 0] }) {
    this.position = normalizeSpacePosition(start)
  }

  update(dt: number, actions: Readonly<ShipActions>): void {
    if (dt <= 0) return

    const yaw = clampAxis(actions.yaw)
    const pitch = clampAxis(actions.pitch)
    const roll = clampAxis(actions.roll)

    // Turn in the ship's local frame; its nose points down local -Z.
    this.turn.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -yaw * TURN_RATE * dt)
    this.orientation.multiply(this.turn)
    // A positive pitch action comes from moving the pointer down or pressing ArrowDown.
    this.turn.setFromAxisAngle(X_AXIS, -pitch * TURN_RATE * dt)
    this.orientation.multiply(this.turn)
    this.turn.setFromAxisAngle(Z_AXIS, -roll * ROLL_RATE * dt)
    this.orientation.multiply(this.turn).normalize()

    this.acceleration.set(
      clampAxis(actions.strafe),
      clampAxis(actions.lift),
      -clampAxis(actions.thrust),
    )
    if (this.acceleration.lengthSq() > 1) this.acceleration.normalize()
    this.acceleration.applyQuaternion(this.orientation)

    const acceleration = actions.boost ? BOOST_ACCELERATION : CRUISE_ACCELERATION
    this.velocity.addScaledVector(this.acceleration, acceleration * dt)
    const damping = actions.brake ? BRAKE_DRAG : actions.boost ? BOOST_DRAG : DRAG
    this.velocity.multiplyScalar(Math.exp(-damping * dt))
    const maxSpeed = actions.boost ? BOOST_MAX_SPEED : CRUISE_MAX_SPEED
    if (this.velocity.lengthSq() > maxSpeed * maxSpeed) this.velocity.setLength(maxSpeed)

    this.position = offsetSpacePosition(this.position, [
      this.velocity.x * dt,
      this.velocity.y * dt,
      this.velocity.z * dt,
    ])
  }

  stop(): void {
    this.velocity.set(0, 0, 0)
  }

  place(position: SpacePosition): void {
    this.position = normalizeSpacePosition(position)
    this.stop()
  }
}

const X_AXIS = new THREE.Vector3(1, 0, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)

function clampAxis(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
}
