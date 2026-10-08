export type SolarPreset = 'orbit' | 'plunge' | 'escape'

const STEP = 1 / 120
const MAX_STEPS_PER_UPDATE = 8
const CORE_RADIUS_SQUARED = 2.5 ** 2
const ESCAPE_RADIUS_SQUARED = 50 ** 2
const SOFTENING_SQUARED = 0.8 ** 2
const DEFAULT_GRAVITY = 650
const DEFAULT_SPEED = 1

function clamp(value: number, fallback: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback
}

/** A fixed-center gravity experiment. Bodies orbit in the XZ plane with slight Y scatter. */
export class SolarSimulation {
  readonly capacity: number
  readonly positions: Float32Array
  readonly velocities: Float32Array
  readonly states: Uint8Array

  count = 0
  captured = 0
  escaped = 0
  elapsed = 0
  gravity = DEFAULT_GRAVITY
  speed = DEFAULT_SPEED

  private readonly seed: number
  private randomState: number
  private accumulator = 0
  private lastPreset: SolarPreset | null = null
  private lastCount = 0

  constructor(capacity: number, seed = 0x5eeda11) {
    this.capacity = Math.floor(clamp(capacity, 1, 1, 100_000))
    this.positions = new Float32Array(this.capacity * 3)
    this.velocities = new Float32Array(this.capacity * 3)
    this.states = new Uint8Array(this.capacity)
    this.seed = (Number.isFinite(seed) ? seed >>> 0 : 0x5eeda11) || 0x5eeda11
    this.randomState = this.seed
  }

  get orbiting(): number {
    return this.count - this.captured - this.escaped
  }

  launch(
    preset: SolarPreset,
    gravity = DEFAULT_GRAVITY,
    speed = DEFAULT_SPEED,
    count = this.capacity,
  ): void {
    this.gravity = clamp(gravity, DEFAULT_GRAVITY, 100, 1_600)
    this.speed = clamp(speed, DEFAULT_SPEED, 0.25, 2.5)
    this.count = Math.floor(clamp(count, this.capacity, 1, this.capacity))
    this.lastCount = this.count
    this.lastPreset = preset
    this.captured = 0
    this.escaped = 0
    this.elapsed = 0
    this.accumulator = 0
    this.randomState = this.seed
    this.positions.fill(0)
    this.velocities.fill(0)
    this.states.fill(0)

    for (let body = 0; body < this.count; body++) {
      const radius = 8 + 26 * Math.sqrt(this.random())
      const angle = this.random() * Math.PI * 2
      const jitter = 0.97 + this.random() * 0.06
      const orbitalSpeed = Math.sqrt(this.gravity / radius) * this.speed * jitter
      const tangentialSpeed = preset === 'plunge'
        ? orbitalSpeed * 0.28
        : preset === 'escape'
          ? orbitalSpeed * 1.82
          : orbitalSpeed
      const radialSpeed = (this.random() - 0.5) * orbitalSpeed * 0.035
      const offset = body * 3
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)

      this.positions[offset] = radius * cos
      this.positions[offset + 1] = (this.random() - 0.5) * 0.85
      this.positions[offset + 2] = radius * sin
      this.velocities[offset] = -sin * tangentialSpeed + cos * radialSpeed
      this.velocities[offset + 1] = (this.random() - 0.5) * 0.045
      this.velocities[offset + 2] = cos * tangentialSpeed + sin * radialSpeed
      this.states[body] = 1
    }
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || this.orbiting === 0) return
    this.accumulator = Math.min(this.accumulator + dt, STEP * MAX_STEPS_PER_UPDATE)
    let steps = 0
    while (this.accumulator + 1e-10 >= STEP && steps < MAX_STEPS_PER_UPDATE) {
      this.integrate()
      this.accumulator -= STEP
      this.elapsed += STEP
      steps++
    }
    this.accumulator = Math.max(0, this.accumulator)
  }

  /** Replays the last launch from its original seed and settings. */
  reset(): void {
    if (this.lastPreset) {
      this.launch(this.lastPreset, this.gravity, this.speed, this.lastCount)
      return
    }
    this.positions.fill(0)
    this.velocities.fill(0)
    this.states.fill(0)
    this.count = 0
    this.captured = 0
    this.escaped = 0
    this.elapsed = 0
    this.accumulator = 0
  }

  private integrate(): void {
    for (let body = 0; body < this.count; body++) {
      if (this.states[body] !== 1) continue
      const offset = body * 3
      let x = this.positions[offset]
      let y = this.positions[offset + 1]
      let z = this.positions[offset + 2]
      const softenedRadiusSquared = x * x + y * y + z * z + SOFTENING_SQUARED
      const inverseRadius = 1 / Math.sqrt(softenedRadiusSquared)
      const acceleration = -this.gravity * inverseRadius ** 3
      const vx = this.velocities[offset] + acceleration * x * STEP
      const vy = this.velocities[offset + 1] + acceleration * y * STEP
      const vz = this.velocities[offset + 2] + acceleration * z * STEP
      x += vx * STEP
      y += vy * STEP
      z += vz * STEP
      this.velocities[offset] = vx
      this.velocities[offset + 1] = vy
      this.velocities[offset + 2] = vz
      this.positions[offset] = x
      this.positions[offset + 1] = y
      this.positions[offset + 2] = z

      const radiusSquared = x * x + y * y + z * z
      if (radiusSquared < CORE_RADIUS_SQUARED) {
        this.states[body] = 2
        this.captured++
      } else if (radiusSquared > ESCAPE_RADIUS_SQUARED) {
        this.states[body] = 3
        this.escaped++
      }
    }
  }

  private random(): number {
    let value = this.randomState
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    this.randomState = value >>> 0
    return this.randomState / 0x1_0000_0000
  }
}
