import type { OrbitDefinition, PlanetDefinition } from '../app/PlanetContracts.ts'
import { offsetSpacePosition, type SpacePosition } from './SpacePosition.ts'

const TAU = Math.PI * 2

/** The fixed portfolio hub, placed ahead of the ship's starting position. */
export const SYSTEM_ZERO_CENTER: SpacePosition = {
  sector: [0, 0, 0],
  local: [0, 0, -760],
}

function normalizedProgress(angle: number): number {
  return ((angle / TAU) % 1 + 1) % 1
}

function positionAtAngle(orbit: OrbitDefinition, angle: number): SpacePosition {
  const radialZ = Math.sin(angle) * orbit.radius
  return offsetSpacePosition(SYSTEM_ZERO_CENTER, [
    Math.cos(angle) * orbit.radius,
    radialZ * Math.sin(orbit.inclination),
    radialZ * Math.cos(orbit.inclination),
  ])
}

/** Shared authoring formula so registry fallback positions match the moving orbit at t=0. */
export function initialOrbitPosition(orbit: OrbitDefinition): SpacePosition {
  return positionAtAngle(orbit, orbit.phase)
}

/** One clock drives rendering, distance checks, map positions, warp, and world exit. */
export class OrbitSystem {
  private elapsedSeconds = 0

  constructor(private readonly definitions: readonly PlanetDefinition[]) {}

  advance(dt: number, motionEnabled = true): void {
    if (motionEnabled && Number.isFinite(dt) && dt > 0) this.elapsedSeconds += dt
  }

  getCenter(): SpacePosition {
    return SYSTEM_ZERO_CENTER
  }

  getPlanets(): readonly PlanetDefinition[] {
    return this.definitions
  }

  getElapsedSeconds(): number {
    return this.elapsedSeconds
  }

  getOrbit(planet: PlanetDefinition): OrbitDefinition {
    return planet.orbit
  }

  /** Current angle around the ring as a normalized 0..1 progress value. */
  getProgress(planet: PlanetDefinition): number {
    const orbit = planet.orbit
    return normalizedProgress(orbit.phase + this.elapsedSeconds * TAU / orbit.periodSeconds)
  }

  getPosition(planet: PlanetDefinition): SpacePosition {
    return this.samplePosition(planet, this.getProgress(planet))
  }

  /** Absolute ring progress; useful for drawing a line without duplicating orbit math. */
  samplePosition(planet: PlanetDefinition, progress: number): SpacePosition {
    return positionAtAngle(planet.orbit, progress * TAU)
  }

  /** World-space units per second along the orbit at its current position. */
  getVelocity(planet: PlanetDefinition): [number, number, number] {
    const orbit = planet.orbit
    const angle = this.getProgress(planet) * TAU
    const rate = TAU / orbit.periodSeconds
    return [
      -orbit.radius * Math.sin(angle) * rate,
      orbit.radius * Math.cos(angle) * Math.sin(orbit.inclination) * rate,
      orbit.radius * Math.cos(angle) * Math.cos(orbit.inclination) * rate,
    ]
  }
}
