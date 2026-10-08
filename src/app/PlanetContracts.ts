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

/** Scoped browser affordances for an interactive world; the shell retains route and renderer ownership. */
export interface PlanetHost {
  canvas: HTMLCanvasElement
  uiRoot: HTMLElement
  onExit(): void
  isInteractive(): boolean
}

export interface PlanetModule {
  prepare(definition: PlanetDefinition, signal: AbortSignal): Promise<PreparedPlanet>
  mount(prepared: PreparedPlanet, host: PlanetHost): PlanetSession
}
