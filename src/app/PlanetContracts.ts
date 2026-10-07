import type { Camera, Scene } from 'three'
import type { SpacePosition } from '../space/SpacePosition.ts'

export type ThemeMode = 'dark' | 'light'

export interface PlanetDefinition {
  slug: string
  title: string
  projectKey: string
  position: SpacePosition
  radius: number
  color: number
  load: () => Promise<PlanetModule>
}

export interface PreparedPlanet {
  scene: Scene
  camera: Camera
  dispose(): void
}

export interface PlanetSession {
  scene: Scene
  camera: Camera
  update(dt: number): void
  dispose(): void
}

export interface PlanetModule {
  prepare(definition: PlanetDefinition, signal: AbortSignal): Promise<PreparedPlanet>
  mount(prepared: PreparedPlanet): PlanetSession
}
