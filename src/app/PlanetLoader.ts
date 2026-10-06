import type { PlanetDefinition, PlanetModule, PreparedPlanet } from './PlanetContracts.ts'

export type LoadStatus = 'idle' | 'preparing' | 'ready' | 'error'

export interface LoadState {
  planet: PlanetDefinition | null
  status: LoadStatus
  error?: Error
}

/** Owns a single prepared landing and drops the result of any superseded request. */
export class PlanetLoader {
  private stateValue: LoadState = { planet: null, status: 'idle' }
  private prepared: PreparedPlanet | null = null
  private module: PlanetModule | null = null
  private pending: Promise<void> | null = null
  private controller: AbortController | null = null
  private generation = 0

  constructor(private readonly onChange: (state: LoadState) => void = () => {}) {}

  get state(): LoadState { return this.stateValue }

  prefetch(planet: PlanetDefinition): Promise<void> {
    if (this.stateValue.planet?.slug === planet.slug && this.stateValue.status === 'ready') return Promise.resolve()
    if (this.stateValue.planet?.slug === planet.slug && this.pending) return this.pending

    this.clear()
    const generation = ++this.generation
    const controller = new AbortController()
    this.controller = controller
    this.setState({ planet, status: 'preparing' })

    const task = (async () => {
      let prepared: PreparedPlanet | null = null
      try {
        const module = await planet.load()
        if (controller.signal.aborted || generation !== this.generation) return
        prepared = await module.prepare(planet, controller.signal)
        if (controller.signal.aborted || generation !== this.generation) {
          prepared.dispose()
          return
        }
        this.module = module
        this.prepared = prepared
        this.setState({ planet, status: 'ready' })
      } catch (cause) {
        prepared?.dispose()
        if (controller.signal.aborted || generation !== this.generation) return
        this.setState({ planet, status: 'error', error: cause instanceof Error ? cause : new Error(String(cause)) })
      } finally {
        if (generation === this.generation) this.pending = null
      }
    })()
    this.pending = task
    return task
  }

  retry(): Promise<void> {
    const planet = this.stateValue.planet
    if (!planet) return Promise.resolve()
    this.clear()
    return this.prefetch(planet)
  }

  takeReady(planet: PlanetDefinition): { module: PlanetModule; prepared: PreparedPlanet } | null {
    if (this.stateValue.planet?.slug !== planet.slug || this.stateValue.status !== 'ready' || !this.module || !this.prepared) return null
    const result = { module: this.module, prepared: this.prepared }
    this.prepared = null
    this.module = null
    this.controller = null
    this.setState({ planet: null, status: 'idle' })
    return result
  }

  clear(): void {
    this.generation++
    this.controller?.abort()
    this.controller = null
    this.prepared?.dispose()
    this.prepared = null
    this.module = null
    this.pending = null
    this.setState({ planet: null, status: 'idle' })
  }

  dispose(): void { this.clear() }

  private setState(state: LoadState): void {
    this.stateValue = state
    this.onChange(state)
  }
}
